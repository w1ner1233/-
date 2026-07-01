// =============================================
//  ESTEL Hair Color Studio — Логика приложения
// =============================================

let currentImage = null;        // оригинал base64
let selectedColor = null;       // выбранный цвет
let currentLine = 'all';        // активная линейка
let searchQuery = '';           // поиск

// ---- Инициализация ---- //
document.addEventListener('DOMContentLoaded', () => {
    renderColors();
    initUpload();
    initSlider();
    initTabs();
    initSearch();
    initApplyButton();
});

// ---- Загрузка фото ---- //
function initUpload() {
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const changePhotoBtn = document.getElementById('changePhotoBtn');

    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', e => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleFile(file);
    });

    changePhotoBtn.addEventListener('click', resetPhoto);
}

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        currentImage = e.target.result;

        // Показываем превью
        const originalImg = document.getElementById('originalImg');
        originalImg.src = currentImage;

        document.getElementById('uploadArea').style.display = 'none';
        document.getElementById('previewArea').style.display = 'block';
        document.getElementById('controlsSection').style.display = 'block';
        document.getElementById('catalogSection').style.display = 'block';

        // Сброс результата
        resetResult();
    };
    reader.readAsDataURL(file);
}

function resetPhoto() {
    currentImage = null;
    selectedColor = null;
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('controlsSection').style.display = 'none';
    document.getElementById('catalogSection').style.display = 'none';
    document.getElementById('fileInput').value = '';
    clearSelectedColor();
}

function resetResult() {
    document.getElementById('resultImg').style.display = 'none';
    document.getElementById('resultPlaceholder').style.display = 'flex';
    document.getElementById('downloadBtn').style.display = 'none';
}

// ---- Слайдер интенсивности ---- //
function initSlider() {
    const slider = document.getElementById('intensitySlider');
    const valueLabel = document.getElementById('intensityValue');

    slider.addEventListener('input', () => {
        const val = slider.value;
        valueLabel.textContent = val + '%';
        // Обновляем градиент
        slider.style.background = `linear-gradient(to right, var(--primary-light) 0%, var(--primary-light) ${val}%, rgba(200,160,220,0.2) ${val}%)`;
        // Если цвет уже выбран — авто-применить
        if (selectedColor && currentImage) {
            applyColorDebounced();
        }
    });
}

// ---- Табы линеек ---- //
function initTabs() {
    document.querySelectorAll('.line-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.line-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentLine = tab.dataset.line;
            renderColors();
        });
    });
}

// ---- Поиск ---- //
function initSearch() {
    const searchInput = document.getElementById('colorSearch');
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.toLowerCase().trim();
        renderColors();
    });
}

// ---- Рендер сетки цветов ---- //
function renderColors() {
    const grid = document.getElementById('colorsGrid');
    grid.innerHTML = '';

    let colors = ALL_COLORS;

    // Фильтр по линейке
    if (currentLine !== 'all') {
        colors = colors.filter(c => c.line === currentLine);
    }

    // Фильтр по поиску
    if (searchQuery) {
        colors = colors.filter(c =>
            c.name.toLowerCase().includes(searchQuery) ||
            c.id.toLowerCase().includes(searchQuery)
        );
    }

    if (colors.length === 0) {
        grid.innerHTML = `
            <div class="empty-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="11" cy="11" r="8"/>
                    <path stroke-linecap="round" stroke-width="2" d="M21 21l-4.35-4.35"/>
                </svg>
                <p>Оттенки не найдены</p>
            </div>`;
        return;
    }

    colors.forEach(color => {
        const item = document.createElement('div');
        item.className = 'color-item' + (selectedColor?.id === color.id ? ' selected' : '');
        item.title = `${color.name} (${color.id})`;
        item.innerHTML = `
            <div class="color-swatch" style="background:${color.hex}"></div>
            <span class="color-name">${color.name}</span>
            <span class="color-id">${color.id}</span>
        `;
        item.addEventListener('click', () => selectColor(color));
        grid.appendChild(item);
    });
}

// ---- Выбор цвета ---- //
function selectColor(color) {
    selectedColor = color;

    // Обновляем выделение в сетке
    document.querySelectorAll('.color-item').forEach(el => {
        el.classList.toggle('selected', el.title.includes(`(${color.id})`));
    });

    // Обновляем инфо-блок
    const info = document.getElementById('selectedColorInfo');
    info.style.display = 'flex';
    document.getElementById('selectedSwatch').style.background = color.hex;
    document.getElementById('selectedName').textContent = color.name;
    document.getElementById('selectedId').textContent = `${color.id} · ${color.line}`;

    // Если фото загружено — применяем
    if (currentImage) {
        applyColor();
    }
}

function clearSelectedColor() {
    selectedColor = null;
    document.querySelectorAll('.color-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('selectedColorInfo').style.display = 'none';
}

// ---- Применить цвет ---- //
let applyTimeout = null;
function applyColorDebounced() {
    clearTimeout(applyTimeout);
    applyTimeout = setTimeout(applyColor, 600);
}

function initApplyButton() {
    document.getElementById('applyBtn').addEventListener('click', applyColor);
}

async function applyColor() {
    if (!currentImage || !selectedColor) return;

    const loading = document.getElementById('loading');
    const applyBtn = document.getElementById('applyBtn');
    const resultImg = document.getElementById('resultImg');
    const resultPlaceholder = document.getElementById('resultPlaceholder');

    loading.style.display = 'flex';
    if (applyBtn) applyBtn.disabled = true;

    try {
        const intensity = document.getElementById('intensitySlider').value / 100;

        const response = await fetch('/apply_color', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: currentImage,
                color: selectedColor.rgb,
                intensity: intensity
            })
        });

        const data = await response.json();

        if (data.success) {
            resultImg.src = data.result;
            resultImg.style.display = 'block';
            resultPlaceholder.style.display = 'none';

            // Кнопка скачать
            const downloadBtn = document.getElementById('downloadBtn');
            downloadBtn.style.display = 'flex';
            downloadBtn.onclick = () => downloadResult(data.result, selectedColor.name);

            showToast(`Применён оттенок: ${selectedColor.name}`, 'success');
        } else {
            showToast(data.error || 'Ошибка обработки', 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения с сервером', 'error');
        console.error(err);
    } finally {
        loading.style.display = 'none';
        if (applyBtn) applyBtn.disabled = false;
    }
}

// ---- Скачать результат ---- //
function downloadResult(dataUrl, colorName) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `estel_${colorName.replace(/\s+/g, '_')}.jpg`;
    a.click();
}

// ---- Toast уведомления ---- //
let toastTimeout = null;
function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ` ${type}` : '');
    toast.classList.add('show');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
