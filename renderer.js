const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

function log(message, data = '') {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.log(logMessage);
    ipcRenderer.invoke('log-message', logMessage);
}

log('Renderer started');

const audioPlayer = document.createElement('audio');
audioPlayer.setAttribute('preload', 'auto');
document.body.appendChild(audioPlayer);

let isPlaying = false;
let playlist = [];
let currentTrackIndex = 0;
let progressInterval;
let isDraggingProgress = false;

const selectMusicBtn = document.querySelector('.select-music-container');
const playButton = document.querySelector('.controls').children[1];
const prevButton = document.querySelector('.controls').children[0];
const nextButton = document.querySelector('.controls').children[2];
const timeDisplay = document.getElementById('time-display');
const trackTitle = document.getElementById('track-title');
const playlistContent = document.getElementById('playlist');
const playlistHeader = document.querySelector('.playlist-header');
const progressSlider = document.querySelector('.progress-slider');
const volumeSlider = document.querySelector('.volume-slider');
const muteButton = document.querySelector('.volume-controls .volume-button:first-child');
const maxVolumeButton = document.querySelector('.volume-controls .volume-button:last-child');
const clearPlaylistButton = document.querySelector('.clear-playlist');


clearPlaylistButton.addEventListener('click', () => {
    // Zatrzymaj odtwarzanie
    audioPlayer.pause();
    audioPlayer.src = '';
    isPlaying = false;
    playButton.textContent = '⏵';
    
    // Wyczyść playlistę
    playlist = [];
    currentTrackIndex = 0;
    
    // Zresetuj interfejs
    trackTitle.textContent = 'No track selected';
    timeDisplay.textContent = '0:00 / 0:00';
    progressSlider.value = 0;
    progressSlider.style.setProperty('--value', '0%');
    
    // Zaktualizuj wyświetlanie playlisty
    const playlistHeaderContent = playlistHeader.querySelector('span');
    if (playlistHeaderContent) {
        playlistHeaderContent.textContent = 'Playlist - 0';
    } else {
        playlistHeader.textContent = 'Playlist - 0';
    }
    playlistContent.innerHTML = '';
});

// Dodaj logi do debugowania
console.log('Mute button:', muteButton);
console.log('Max volume button:', maxVolumeButton);

muteButton.addEventListener('click', () => {
    console.log('Mute clicked');
    volumeSlider.value = 0;
    audioPlayer.volume = 0;
    volumeSlider.style.setProperty('--value', '0%');
});

maxVolumeButton.addEventListener('click', () => {
    console.log('Max volume clicked');
    volumeSlider.value = 1;
    audioPlayer.volume = 1;
    volumeSlider.style.setProperty('--value', '100%');
});

function getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac'
    };
    return mimeTypes[ext] || 'audio/mpeg';
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsArrayBuffer(file);
    });
}

const playerControls = document.querySelector('.player-controls-container');

playerControls.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    playerControls.classList.add('drag-over');
});

playerControls.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

playerControls.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    playerControls.classList.remove('drag-over');
});

playerControls.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    playerControls.classList.remove('drag-over');

    try {
        const files = Array.from(e.dataTransfer.files);
        log('Processing ' + files.length + ' files');

        const validFiles = [];
        
        for (const file of files) {
            log('Processing file:', {
                name: file.name,
                type: file.type,
                size: file.size
            });

            const ext = path.extname(file.name).toLowerCase();
            if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) {
                try {
                    const fileData = await readFile(file);
                    log('File read successfully:', file.name);
                    
                    validFiles.push({
                        name: file.name,
                        data: fileData,
                        type: file.type || getMimeType(file.name)
                    });
                } catch (error) {
                    log('Error reading file:', file.name, error);
                }
            }
        }

        log('Valid files:', validFiles.map(f => f.name));

        if (validFiles.length > 0) {
            playlist = [...playlist, ...validFiles];
            
            if (playlist.length === validFiles.length) {
                currentTrackIndex = 0;
                await loadTrack(currentTrackIndex);
                if (!isPlaying) {
                    togglePlay();
                }
            }

            updatePlaylistDisplay();
        }
    } catch (error) {
        log('Drop handling error:', error);
    }
});

async function selectMusic() {
    try {
        const files = await ipcRenderer.invoke('select-music');
        log('Wybrane pliki:', files);
        
        if (files && files.length > 0) {
            const newTracks = await Promise.all(
                files.map(async (filePath) => {
                    try {
                        const data = await fs.promises.readFile(filePath);
                        return {
                            name: path.basename(filePath),
                            data: data.buffer,
                            type: getMimeType(filePath),
                            filePath: filePath
                        };
                    } catch (error) {
                        log('Błąd odczytu pliku:', filePath, error);
                        return null;
                    }
                })
            );
            
            const validTracks = newTracks.filter(track => track !== null);
            playlist = [...playlist, ...validTracks];
            
            if (playlist.length > 0) {
                currentTrackIndex = playlist.length - validTracks.length;
                await loadTrack(currentTrackIndex);
                if (!isPlaying) {
                    togglePlay();
                }
            }
            
            updatePlaylistDisplay();
        }
    } catch (error) {
        log('Błąd wyboru muzyki:', error);
    }
}

function updatePlaylistDisplay() {
    const playlistHeaderContent = playlistHeader.querySelector('span');
    if (playlistHeaderContent) {
        playlistHeaderContent.textContent = `Playlist - ${playlist.length}`;
    } else {
        playlistHeader.textContent = `Playlist - ${playlist.length}`;
    }
    
    playlistContent.innerHTML = '';
    
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

async function loadTrack(index) {
    if (!playlist[index]) {
        log('Nieprawidłowy indeks utworu:', index);
        return;
    }

    const track = playlist[index];
    log('Ładowanie utworu:', track.name);

    trackTitle.textContent = track.name;
    
    try {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;

        const blob = new Blob([track.data], { type: track.type });
        const audioUrl = URL.createObjectURL(blob);
        
        log('Utworzono URL blob dla:', track.name);

        if (track.blobUrl) {
            URL.revokeObjectURL(track.blobUrl);
        }
        
        track.blobUrl = audioUrl;
        audioPlayer.src = audioUrl;
        audioPlayer.load();

        if (isPlaying) {
            await audioPlayer.play();
            playButton.textContent = '⏸';
            log('Rozpoczęto odtwarzanie');
        }

        updatePlaylistDisplay();
    } catch (error) {
        log('Błąd ładowania utworu:', error);
        console.error('Błąd w loadTrack:', error);
    }
}

async function togglePlay() {
    try {
        if (audioPlayer.paused) {
            await audioPlayer.play();
            playButton.textContent = '⏸';
            isPlaying = true;
            startProgressUpdate();
            log('Rozpoczęto odtwarzanie');
        } else {
            audioPlayer.pause();
            playButton.textContent = '⏵';
            isPlaying = false;
            stopProgressUpdate();
            log('Wstrzymano odtwarzanie');
        }
    } catch (error) {
        log('Błąd przełączania odtwarzania:', error);
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

selectMusicBtn.addEventListener('click', selectMusic);
playButton.addEventListener('click', togglePlay);
prevButton.addEventListener('click', async () => {
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        await loadTrack(currentTrackIndex);
    }
});
nextButton.addEventListener('click', async () => {
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        await loadTrack(currentTrackIndex);
    }
});

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

volumeSlider.addEventListener('input', (e) => {
    const volumeValue = e.target.value;
    audioPlayer.volume = volumeValue;
    e.target.style.setProperty('--value', `${volumeValue * 100}%`);
});

audioPlayer.addEventListener('ended', () => {
    stopProgressUpdate();
    if (playlist.length > 0) {
        currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        loadTrack(currentTrackIndex);
    }
});

audioPlayer.addEventListener('loadedmetadata', () => {
    log('Audio loadedmetadata event');
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

audioPlayer.addEventListener('error', (e) => {
    log('Audio error event:', {
        type: e.type,
        error: audioPlayer.error ? {
            code: audioPlayer.error.code,
            message: audioPlayer.error.message
        } : 'No error details'
    });
    stopProgressUpdate();
});

function cleanup() {
    playlist.forEach(track => {
        if (track.blobUrl) {
            URL.revokeObjectURL(track.blobUrl);
        }
    });
}

window.addEventListener('unload', cleanup);

audioPlayer.addEventListener('loadstart', () => log('Audio loadstart'));
audioPlayer.addEventListener('durationchange', () => log('Audio durationchange'));
audioPlayer.addEventListener('loadeddata', () => log('Audio loadeddata'));
audioPlayer.addEventListener('canplay', () => log('Audio canplay'));
audioPlayer.addEventListener('canplaythrough', () => log('Audio canplaythrough'));
audioPlayer.addEventListener('play', () => log('Audio play'));
audioPlayer.addEventListener('pause', () => log('Audio pause'));
audioPlayer.addEventListener('playing', () => log('Audio playing'));
audioPlayer.addEventListener('timeupdate', () => log('Audio timeupdate', {
    currentTime: audioPlayer.currentTime,
    duration: audioPlayer.duration
}));