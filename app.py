from flask import Flask, render_template, request, jsonify
import cv2
import numpy as np
import base64
import os
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

app = Flask(__name__)

# Путь к модели нейросети сегментации волос
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hair_segmenter.tflite')
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite'

def ensure_model():
    """Скачать модель если её нет"""
    if not os.path.exists(MODEL_PATH):
        import urllib.request
        print(f'Скачиваю модель сегментации волос...')
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print(f'Модель скачана: {os.path.getsize(MODEL_PATH)} байт')

ensure_model()

# Инициализируем сегментатор один раз при старте
_segmenter = None

def get_segmenter():
    global _segmenter
    if _segmenter is None:
        base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
        options = mp_vision.ImageSegmenterOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            output_category_mask=True,
        )
        _segmenter = mp_vision.ImageSegmenter.create_from_options(options)
    return _segmenter


def base64_to_image(base64_str):
    """Конвертировать base64 строку в numpy array (BGR)"""
    if ',' in base64_str:
        base64_str = base64_str.split(',')[1]
    img_bytes = base64.b64decode(base64_str)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    return img

def image_to_base64(img):
    """Конвертировать numpy array в base64 строку"""
    _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 93])
    return base64.b64encode(buffer).decode('utf-8')


def segment_hair(image_bgr):
    """
    Сегментация волос через нейросеть MediaPipe hair_segmenter.
    Возвращает (hair_mask uint8 0/255, hair_mask_blur float32 0-255).
    """
    h, w = image_bgr.shape[:2]

    # Конвертируем BGR → RGB для MediaPipe
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)

    segmenter = get_segmenter()
    result = segmenter.segment(mp_image)

    # category_mask: 0 = фон, 1 = волосы
    cat_mask = result.category_mask.numpy_view()  # shape (H, W), uint8

    # Масштабируем к размеру оригинала если нужно
    if cat_mask.shape[:2] != (h, w):
        cat_mask = cv2.resize(cat_mask, (w, h), interpolation=cv2.INTER_NEAREST)

    # Волосы = класс 1
    hair_mask = np.where(cat_mask == 1, np.uint8(255), np.uint8(0))

    # Морфология: закрыть дыры, чуть расширить
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    k_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4, 4))
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_CLOSE, k_close)
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_DILATE, k_dilate)

    # Плавные края
    hair_mask_blur = cv2.GaussianBlur(hair_mask.astype(np.float32), (31, 31), 10)

    return hair_mask, hair_mask_blur

def apply_hair_color(image, target_color_rgb, intensity=0.75):
    """
    Нанести цвет краски на волосы.
    Использует HSL-смешение: сохраняем структуру светлых/тёмных участков,
    меняем только цвет (hue + saturation).
    """
    hair_mask, hair_mask_blur = segment_hair(image)

    if hair_mask.sum() == 0:
        return image, False

    image_float = image.astype(np.float32)

    # ---- Конвертируем в HLS (Hue-Lightness-Saturation) ----
    image_hls = cv2.cvtColor(image, cv2.COLOR_BGR2HLS).astype(np.float32)

    # HLS целевого цвета (передаём RGB → BGR для cv2)
    target_bgr_px = np.uint8([[[target_color_rgb[2], target_color_rgb[1], target_color_rgb[0]]]])
    target_hls = cv2.cvtColor(target_bgr_px, cv2.COLOR_BGR2HLS).astype(np.float32)
    t_h = float(target_hls[0, 0, 0])   # целевой оттенок 0-180
    t_l = float(target_hls[0, 0, 1])   # яркость
    t_s = float(target_hls[0, 0, 2])   # насыщенность

    # ---- Оригинальные каналы ----
    orig_h = image_hls[:, :, 0]
    orig_l = image_hls[:, :, 1]
    orig_s = image_hls[:, :, 2]

    # ---- Строим окрашенное HLS ----
    colored_hls = image_hls.copy()

    # Оттенок: полностью заменяем на целевой
    colored_hls[:, :, 0] = t_h

    # Яркость: сохраняем структуру оригинала, адаптируем к яркости целевого цвета
    # Нормализуем оригинальную яркость относительно её среднего в зоне волос
    mask_norm = (hair_mask_blur / 255.0)
    mean_l = float(np.sum(orig_l * mask_norm) / (np.sum(mask_norm) + 1e-6))
    # Смещаем яркость к целевой, сохраняя перепады (тени/блики)
    l_ratio = orig_l / (mean_l + 1e-6)
    new_l = t_l * l_ratio
    new_l = np.clip(new_l, 0, 255)
    # Смешиваем оригинальную яркость с новой (сохраняем 30% оригинала для натуральности)
    blend_l = 0.30
    colored_hls[:, :, 1] = orig_l * blend_l + new_l * (1 - blend_l)
    colored_hls[:, :, 1] = np.clip(colored_hls[:, :, 1], 0, 255)

    # Насыщенность: поднимаем до целевой, сохраняем немного оригинала
    new_s = orig_s * 0.2 + t_s * 0.8
    colored_hls[:, :, 2] = np.clip(new_s, 0, 255)

    # ---- Конвертируем обратно в BGR ----
    colored_bgr = cv2.cvtColor(colored_hls.astype(np.uint8), cv2.COLOR_HLS2BGR).astype(np.float32)

    # ---- Смешиваем по маске ----
    # intensity управляет силой эффекта
    alpha = (mask_norm * intensity)[:, :, np.newaxis]
    result = image_float * (1.0 - alpha) + colored_bgr * alpha
    result = np.clip(result, 0, 255).astype(np.uint8)

    return result, True


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/apply_color', methods=['POST'])
def apply_color():
    try:
        data = request.json
        image_data = data.get('image')
        color_rgb = data.get('color')  # [R, G, B]
        intensity = data.get('intensity', 0.75)
        
        if not image_data or not color_rgb:
            return jsonify({'error': 'Нет данных'}), 400
        
        # Декодируем изображение
        img = base64_to_image(image_data)
        if img is None:
            return jsonify({'error': 'Не удалось декодировать изображение'}), 400
        
        # Применяем цвет
        result_img, success = apply_hair_color(img, color_rgb, intensity)
        
        if not success:
            return jsonify({'error': 'Волосы не найдены на фото. Попробуйте другое фото.'}), 400
        
        # Кодируем результат
        result_base64 = image_to_base64(result_img)
        
        return jsonify({
            'success': True,
            'result': f'data:image/jpeg;base64,{result_base64}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
