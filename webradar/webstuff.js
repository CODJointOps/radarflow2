function toggleDangerousOptions() {
    const dangerousSection = document.getElementById('dangerousOptions');
    const button = document.getElementById('showDangerousBtn');

    if (dangerousSection.classList.contains('revealed')) {
        dangerousSection.classList.remove('revealed');
        button.textContent = 'Show Dangerous Options';
    } else {
        dangerousSection.classList.add('revealed');
        button.textContent = 'Hide Dangerous Options';
    }
}

function toggleMenu(show) {
    const settingsHolder = document.getElementById('settingsHolder');
    const showMenuBtn = document.getElementById('showMenuBtn');

    if (show) {
        settingsHolder.style.display = 'block';
        showMenuBtn.style.display = 'none';
    } else {
        settingsHolder.style.display = 'none';
        showMenuBtn.style.display = 'block';
    }
}