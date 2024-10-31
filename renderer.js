const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Logger
function log(message, data = '') {
    const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
    console.log(logMessage);
    ipcRenderer.invoke('log-message', logMessage);
}

log('Renderer started');

// Audio Player Setup
const audioPlayer = document.createElement('audio');
audioPlayer.setAttribute('preload', 'auto');
document.body.appendChild(audioPlayer);

// State
let isPlaying = false;
let playlist = [];
let currentTrackIndex = 0;
let progressInterval;
let isDraggingProgress = false;
let isShuffleEnabled = false;
let originalPlaylist = [];
let shuffledIndices = [];
let isLoopEnabled = false;
let dragTimeout;

// DOM Elements
const selectMusicBtn = document.querySelector('.select-music-container');
const playButton = document.querySelector('.controls').children[1];
const prevButton = document.querySelector('.controls').children[0];
const nextButton = document.querySelector('.controls').children[2];
const shuffleButton = document.querySelector('.shuffle-button');
const timeDisplay = document.getElementById('time-display');
const trackTitle = document.getElementById('track-title');
const playlistContent = document.getElementById('playlist');
const playlistHeader = document.querySelector('.playlist-header');
const progressSlider = document.querySelector('.progress-slider');
const volumeSlider = document.querySelector('.volume-slider');
const muteButton = document.querySelector('.volume-controls .volume-button:first-child');
const maxVolumeButton = document.querySelector('.volume-controls .volume-button:last-child');
const clearPlaylistButton = document.querySelector('.clear-playlist');
const loopButton = document.querySelector('.loop-button');
const playlistContainer = document.querySelector('.playlist-container');

// Loop functionality
function toggleLoop() {
    if (playlist.length <= 1) return;
    
    if (isShuffleEnabled) {
        isShuffleEnabled = false;
        shuffleButton.classList.remove('active');
        if (originalPlaylist.length > 0) {
            const currentTrack = playlist[currentTrackIndex];
            playlist = [...originalPlaylist];
            currentTrackIndex = playlist.findIndex(track => track === currentTrack);
            originalPlaylist = [];
        }
    }

    isLoopEnabled = !isLoopEnabled;
    loopButton.classList.toggle('active', isLoopEnabled);
}

// Shuffle functionality
function shufflePlaylist() {
    if (playlist.length <= 1) return;
    
    if (isLoopEnabled) {
        isLoopEnabled = false;
        loopButton.classList.remove('active');
    }

    if (!isShuffleEnabled) {
        isShuffleEnabled = true;
        originalPlaylist = [...playlist];
        shuffledIndices = Array.from({length: playlist.length}, (_, i) => i);
        
        // Fisher-Yates shuffle
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
        
        const currentTrack = playlist[currentTrackIndex];
        currentTrackIndex = shuffledIndices.findIndex(i => playlist[i] === currentTrack);
        
        shuffleButton.classList.add('active');
    } else {
        isShuffleEnabled = false;
        const currentTrack = playlist[currentTrackIndex];
        playlist = [...originalPlaylist];
        currentTrackIndex = playlist.findIndex(track => track === currentTrack);
        originalPlaylist = [];
        shuffleButton.classList.remove('active');
    }
    
    updatePlaylistDisplay();
}

// Clear playlist
clearPlaylistButton.addEventListener('click', () => {
    audioPlayer.pause();
    audioPlayer.src = '';
    isPlaying = false;
    playButton.textContent = '⏵';
    
    playlist = [];
    currentTrackIndex = 0;
    
    trackTitle.textContent = '[NO TRACK SELECTED]';
    timeDisplay.textContent = '0:00 / 0:00';
    progressSlider.value = 0;
    progressSlider.style.setProperty('--value', '0%');
    
    const playlistHeaderContent = playlistHeader.querySelector('span');
    if (playlistHeaderContent) {
        playlistHeaderContent.textContent = 'PLAYLIST EMPTY';
    }
    playlistContent.innerHTML = '';
});

// Volume controls
muteButton.addEventListener('click', () => {
    volumeSlider.value = 0;
    audioPlayer.volume = 0;
    volumeSlider.style.setProperty('--value', '0%');
});

maxVolumeButton.addEventListener('click', () => {
    volumeSlider.value = 1;
    audioPlayer.volume = 1;
    volumeSlider.style.setProperty('--value', '100%');
});

// File handling utilities
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

// Drag and Drop handling
playlistContainer.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragTimeout) {
        clearTimeout(dragTimeout);
    }
    
    requestAnimationFrame(() => {
        playlistContainer.classList.add('drag-over');
    });
});

playlistContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragTimeout) {
        clearTimeout(dragTimeout);
    }
});

playlistContainer.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const rect = playlistContainer.getBoundingClientRect();
    const isInside = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
    );
    
    if (!isInside) {
        dragTimeout = setTimeout(() => {
            playlistContainer.classList.remove('drag-over');
        }, 100);
    }
});

playlistContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragTimeout) {
        clearTimeout(dragTimeout);
    }
    
    setTimeout(() => {
        playlistContainer.classList.remove('drag-over');
    }, 300);

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

// File selection handling
async function selectMusic() {
    try {
        const files = await ipcRenderer.invoke('select-music');
        log('Selected files:', files);
        
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
                        log('File reading error:', filePath, error);
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
        log('Music selection error:', error);
    }
}

// Playlist display
function updatePlaylistDisplay() {
    const playlistHeaderContent = playlistHeader.querySelector('.playlist-title');
    if (playlistHeaderContent) {
        playlistHeaderContent.textContent = `PLAYLIST`;
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

// Track loading and playback
async function loadTrack(index) {
    if (!playlist[index]) {
        log('Invalid track index:', index);
        return;
    }

    const track = playlist[index];
    log('Loading track:', track.name);

    trackTitle.textContent = track.name;
    
    try {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;

        const blob = new Blob([track.data], { type: track.type });
        const audioUrl = URL.createObjectURL(blob);
        
        log('Created blob URL for:', track.name);

        if (track.blobUrl) {
            URL.revokeObjectURL(track.blobUrl);
        }
        
        track.blobUrl = audioUrl;
        audioPlayer.src = audioUrl;
        audioPlayer.load();

        if (isPlaying) {
            await audioPlayer.play();
            playButton.textContent = '⏸';
            log('Playback started');
        }

        volumeSlider.value = audioPlayer.volume;
        volumeSlider.style.setProperty('--value', `${audioPlayer.volume * 100}%`);

        updatePlaylistDisplay();
    } catch (error) {
        log('Track loading error:', error);
        console.error('Error in loadTrack:', error);
    }
}

// Playback control
async function togglePlay() {
    try {
        if (audioPlayer.paused) {
            await audioPlayer.play();
            playButton.textContent = '⏸';
            isPlaying = true;
            startProgressUpdate();
            log('Playback started');
        } else {
            audioPlayer.pause();
            playButton.textContent = '⏵';
            isPlaying = false;
            stopProgressUpdate();
            log('Playback paused');
        }
    } catch (error) {
        log('Playback toggle error:', error);
    }
}

// Time formatting
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Progress bar handling
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

// Event listeners
selectMusicBtn.addEventListener('click', selectMusic);
playButton.addEventListener('click', togglePlay);
shuffleButton.addEventListener('click', shufflePlaylist);
loopButton.addEventListener('click', toggleLoop);

prevButton.addEventListener('click', async () => {
    if (playlist.length > 0) {
        if (isShuffleEnabled) {
            const currentShuffleIndex = shuffledIndices.findIndex(i => i === currentTrackIndex);
            const prevShuffleIndex = (currentShuffleIndex - 1 + shuffledIndices.length) % shuffledIndices.length;
            currentTrackIndex = shuffledIndices[prevShuffleIndex];
        } else {
            currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        }
        await loadTrack(currentTrackIndex);
    }
});

nextButton.addEventListener('click', async () => {
    if (playlist.length > 0) {
        if (isShuffleEnabled) {
            const currentShuffleIndex = shuffledIndices.findIndex(i => i === currentTrackIndex);
            const nextShuffleIndex = (currentShuffleIndex + 1) % shuffledIndices.length;
            currentTrackIndex = shuffledIndices[nextShuffleIndex];
        } else {
            currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        }
        await loadTrack(currentTrackIndex);
    }
});

// Progress bar event listeners
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

// Volume slider event listener
volumeSlider.addEventListener('input', (e) => {
   const volumeValue = e.target.value;
   audioPlayer.volume = volumeValue;
   e.target.style.setProperty('--value', `${volumeValue * 100}%`);
});

// Audio player event listeners
audioPlayer.addEventListener('ended', () => {
    stopProgressUpdate();
    if (isLoopEnabled) {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
        startProgressUpdate();
    } else if (playlist.length > 0) {
        if (isShuffleEnabled) {
            const currentShuffleIndex = shuffledIndices.findIndex(i => i === currentTrackIndex);
            const nextShuffleIndex = (currentShuffleIndex + 1) % shuffledIndices.length;
            currentTrackIndex = shuffledIndices[nextShuffleIndex];
        } else {
            currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        }
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
   volumeSlider.value = audioPlayer.volume;
   volumeSlider.style.setProperty('--value', `${audioPlayer.volume * 100}%`);
   
   timeDisplay.textContent = `0:00 / ${formatTime(audioPlayer.duration)}`;
   
   if (!audioPlayer.paused) {
       startProgressUpdate();
   }
});

audioPlayer.addEventListener('volumechange', () => {
   volumeSlider.value = audioPlayer.volume;
   volumeSlider.style.setProperty('--value', `${audioPlayer.volume * 100}%`);
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

// Cleanup function for blob URLs
function cleanup() {
   playlist.forEach(track => {
       if (track.blobUrl) {
           URL.revokeObjectURL(track.blobUrl);
       }
   });
}

// Cleanup on window unload
window.addEventListener('unload', cleanup);