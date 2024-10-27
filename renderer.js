const { ipcRenderer } = require('electron');
const path = require('path');

// Utworzenie obiektu Audio
const audioPlayer = new Audio();
let isPlaying = false;
let playlist = [];
let currentTrackIndex = 0;
let progressInterval;
let isDraggingProgress = false;

// Elementy DOM
const selectMusicBtn = document.querySelector('.select-music-container');
const playButton = document.querySelector('.controls').children[1];
const prevButton = document.querySelector('.controls').children[0];
const nextButton = document.querySelector('.controls').children[2];
const timeDisplay = document.getElementById('time-display');
const trackTitle = document.getElementById('track-title');
const playlistContent = document.getElementById('playlist');
const playlistHeader = document.querySelector('.playlist-header');

// Dodajemy referencje do suwaków
const progressSlider = document.querySelector('.slider-container input[type="range"]:first-child');
const volumeSlider = document.querySelector('.slider-container input[type="range"]:last-child');

// Konfiguracja początkowa suwaków
progressSlider.value = 0;
volumeSlider.value = 1;
audioPlayer.volume = volumeSlider.value;

async function selectMusic() {
    try {
        const files = await ipcRenderer.invoke('select-music');
        console.log('Wybrane pliki:', files);
        
        if (files && files.length > 0) {
            // Zamiast nadpisywać playlistę, dodajemy nowe utwory
            const newTracks = files.map(file => ({
                path: file,
                name: path.basename(file)
            }));
            
            // Dodajemy nowe utwory do istniejącej playlisty
            playlist = [...playlist, ...newTracks];
            
            // Jeśli to pierwsze dodanie utworów (playlista była pusta), rozpocznij odtwarzanie
            if (playlist.length === newTracks.length) {
                currentTrackIndex = 0;
                loadTrack(currentTrackIndex);
            }
            
            updatePlaylistDisplay();
        }
    } catch (error) {
        console.error('Błąd podczas wybierania muzyki:', error);
    }
}

function updatePlaylistDisplay() {
    // Aktualizacja nagłówka playlisty
    playlistHeader.textContent = `Playlist - ${playlist.length} `;
    
    // Czyszczenie playlisty
    playlistContent.innerHTML = '';
    
    // Dodawanie utworów do playlisty
    playlist.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        
        if (index === currentTrackIndex) {
            item.classList.add('playing');
        }
        
        const trackNumber = document.createElement('span');
        trackNumber.textContent = `${index + 1}.`;
        trackNumber.className = 'track-number';
        
        const trackName = document.createElement('span');
        trackName.textContent = track.name;
        trackName.className = 'track-name';
        
        item.appendChild(trackNumber);
        item.appendChild(trackName);
        
        item.addEventListener('click', () => {
            currentTrackIndex = index;
            loadTrack(currentTrackIndex);
        });
        
        playlistContent.appendChild(item);
    });
}

function loadTrack(index) {
    if (playlist[index]) {
        const track = playlist[index];
        trackTitle.textContent = track.name;
        audioPlayer.src = `file://${track.path}`;
        
        if (isPlaying) {
            const playPromise = audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        playButton.textContent = '⏸️';
                    })
                    .catch(error => {
                        console.error('Błąd odtwarzania:', error);
                    });
            }
        }
        
        updatePlaylistDisplay();
    }
}

function togglePlay() {
    if (audioPlayer.paused) {
        const playPromise = audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    playButton.textContent = '⏸'; 
                    isPlaying = true;
                    startProgressUpdate();
                })
                .catch(error => {
                    console.error('Błąd odtwarzania:', error);
                });
        }
    } else {
        audioPlayer.pause();
        playButton.textContent = '⏵';  
        isPlaying = false;
        stopProgressUpdate();
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function startProgressUpdate() {
    if (progressInterval) {
        cancelAnimationFrame(progressInterval);
    }
    
    const updateProgressBar = () => {
        if (!audioPlayer.paused && !isDraggingProgress) {
            const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            progressSlider.style.setProperty('--value', `${progress}%`);
            progressSlider.value = progress;
            timeDisplay.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration)}`;
        }
        progressInterval = requestAnimationFrame(updateProgressBar);
    };

    progressInterval = requestAnimationFrame(updateProgressBar);
}

function stopProgressUpdate() {
    if (progressInterval) {
        cancelAnimationFrame(progressInterval);
        progressInterval = null;
    }
}

// Event Listenery
selectMusicBtn.addEventListener('click', selectMusic);
playButton.addEventListener('click', togglePlay);
prevButton.addEventListener('click', () => {
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        loadTrack(currentTrackIndex);
    }
});
nextButton.addEventListener('click', () => {
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        loadTrack(currentTrackIndex);
    }
});

// Obsługa suwaka postępu
progressSlider.addEventListener('mousedown', () => {
    isDraggingProgress = true;
    stopProgressUpdate();
});

progressSlider.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) {
        const progress = e.target.value;
        e.target.style.setProperty('--value', `${progress}%`);
        const time = (progress / 100) * audioPlayer.duration;
        timeDisplay.textContent = `${formatTime(time)} / ${formatTime(audioPlayer.duration)}`;
    }
});

progressSlider.addEventListener('input', (e) => {
    const progress = e.target.value;
    e.target.style.setProperty('--value', `${progress}%`);
    const time = (progress / 100) * audioPlayer.duration;
    timeDisplay.textContent = `${formatTime(time)} / ${formatTime(audioPlayer.duration)}`;
});

progressSlider.addEventListener('mouseup', () => {
    isDraggingProgress = false;
    const time = (progressSlider.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = time;
    if (!audioPlayer.paused) {
        startProgressUpdate();
    }
});

progressSlider.addEventListener('mouseleave', () => {
    if (isDraggingProgress) {
        isDraggingProgress = false;
        if (!audioPlayer.paused) {
            startProgressUpdate();
        }
    }
});

// Obsługa suwaka głośności
volumeSlider.addEventListener('input', (e) => {
    const volumeValue = e.target.value;
    audioPlayer.volume = volumeValue;
    e.target.style.setProperty('--value', `${volumeValue * 100}%`);
});

// Obsługa zakończenia utworu
audioPlayer.addEventListener('ended', () => {
    stopProgressUpdate();
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        loadTrack(currentTrackIndex);
    }
});

// Obsługa załadowania metadanych
audioPlayer.addEventListener('loadedmetadata', () => {
    progressSlider.min = 0;
    progressSlider.max = 100;
    progressSlider.value = 0;
    progressSlider.style.setProperty('--value', '0%');
    
    volumeSlider.min = 0;
    volumeSlider.max = 1;
    volumeSlider.step = 0.01;
    volumeSlider.style.setProperty('--value', '100%');
    
    timeDisplay.textContent = `0:00 / ${formatTime(audioPlayer.duration)}`;
    
    if (!audioPlayer.paused) {
        startProgressUpdate();
    }
});

// Obsługa błędów
audioPlayer.addEventListener('error', (e) => {
    stopProgressUpdate();
    console.error('Błąd audio:', e);
    if (audioPlayer.error) {
        console.error('Kod błędu:', audioPlayer.error.code);
        console.error('Wiadomość błędu:', audioPlayer.error.message);
    }
});