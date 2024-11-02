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

// Audio Context initialization
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Stereometer Class Definition
class Stereometer {
    constructor(audioContext, audioElement) {
        this.audioContext = audioContext;
        this.audioElement = audioElement;
        this.isInitialized = false;
        this.mode = 'logarithmic';
        this.colorMode = 'static';
        
        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 200;
        this.ctx = this.canvas.getContext('2d');
        
        // Audio nodes
        this.source = null;
        this.splitter = null;
        this.analyserLeft = null;
        this.analyserRight = null;
        
        // Particle system
        this.particles = [];
        this.particleCount = 15;
        this.particleSize = 6;
        
        this.animationFrame = null;
        
        this.initialize();
    }

    initialize() {
        if (this.isInitialized) return;

        this.source = this.audioContext.createMediaElementSource(this.audioElement);
        this.splitter = this.audioContext.createChannelSplitter(2);
        this.analyserLeft = this.audioContext.createAnalyser();
        this.analyserRight = this.audioContext.createAnalyser();
        
        [this.analyserLeft, this.analyserRight].forEach(analyser => {
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.85;
        });
        
        this.source.connect(this.splitter);
        this.splitter.connect(this.analyserLeft, 0);
        this.splitter.connect(this.analyserRight, 1);
        this.source.connect(this.audioContext.destination);
        
        this.initParticles();
        this.isInitialized = true;
    }

    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                size: this.particleSize,
                speed: 0,
                angle: 0,
                intensity: 0,
                targetX: 0,
                targetY: 0
            });
        }
    }

    updateParticles(audioData) {
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        this.particles.forEach((particle, index) => {
            const dataIndex = Math.floor((index / this.particleCount) * (audioData.length / 4));
            const intensity = audioData[dataIndex] / 255;
            particle.intensity = intensity;

            switch(this.mode) {
                case 'logarithmic':
                    particle.targetX = centerX + (index - this.particleCount/2) * 20 * Math.log(1 + intensity);
                    particle.targetY = centerY - intensity * 150;
                    break;
                
                case 'linear':
                    const angle = -Math.PI/4;
                    const distance = intensity * 200;
                    particle.targetX = centerX + Math.cos(angle) * distance * (index / this.particleCount);
                    particle.targetY = centerY + Math.sin(angle) * distance;
                    break;
                
                case 'lissajous':
                    const time = Date.now() / 1000;
                    const scale = 50 * intensity;
                    particle.targetX = centerX + Math.sin(time * 2 + index) * scale;
                    particle.targetY = centerY + Math.cos(time * 3 + index) * scale;
                    break;
            }

            particle.x += (particle.targetX - particle.x) * 0.2;
            particle.y += (particle.targetY - particle.y) * 0.2;
        });
    }

    draw() {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(particle => {
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            
            let color;
            switch(this.colorMode) {
                case 'static':
                    color = `rgb(0, ${Math.floor(255 * particle.intensity)}, 0)`;
                    break;
                case 'rgb':
                    const hue = particle.intensity * 120;
                    color = `hsl(${hue}, 100%, 50%)`;
                    break;
                case 'multi-band':
                    const bandHue = (particle.x / this.canvas.width) * 120;
                    color = `hsl(${bandHue}, 100%, ${50 + particle.intensity * 50}%)`;
                    break;
            }
            
            this.ctx.fillStyle = color;
            this.ctx.fill();

            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size * 1.5, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(0, ${Math.floor(255 * particle.intensity * 0.5)}, 0, 0.3)`;
            this.ctx.fill();
        });
    }

    animate() {
        if (!this.isInitialized) return;

        const audioData = new Uint8Array(this.analyserLeft.frequencyBinCount);
        this.analyserLeft.getByteFrequencyData(audioData);
        
        this.updateParticles(audioData);
        this.draw();
        
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    setMode(mode) {
        this.mode = mode;
        this.initParticles();
    }

    setColorMode(colorMode) {
        this.colorMode = colorMode;
    }

    start() {
        if (!this.isInitialized) this.initialize();
        this.animate();
    }

    stop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    getCanvas() {
        return this.canvas;
    }
}

// Audio Player Setup
const audioPlayer = document.createElement('audio');
audioPlayer.setAttribute('preload', 'auto');
document.body.appendChild(audioPlayer);

// Initialize Stereometer
let stereometer;
const canvasContainer = document.querySelector('.stereometer-canvas-container');

// Function to initialize Stereometer only when needed
function initializeStereometer() {
    if (!stereometer) {
        stereometer = new Stereometer(audioContext, audioPlayer);
        canvasContainer.appendChild(stereometer.getCanvas());
    }
}

// Stereometer Controls
const stereoControls = document.querySelector('.stereo-controls');
const stereoSection = document.querySelector('.stereometer-section');
const toggleButton = document.querySelector('.toggle-button');

// Domyślnie visualizer jest ukryty i przycisk nieaktywny
stereoSection.classList.add('hidden');
toggleButton.classList.remove('active');

stereoControls.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        const type = e.target.parentNode.className;
        const value = e.target.dataset.mode || e.target.dataset.color;
        
        const buttons = e.target.parentNode.querySelectorAll('button');
        buttons.forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        
        if (type === 'stereo-mode') {
            stereometer.setMode(value);
        } else {
            stereometer.setColorMode(value);
        }
    }
});

// Toggle stereometer visibility
toggleButton.addEventListener('click', () => {
    stereoSection.classList.toggle('hidden');
    toggleButton.classList.toggle('active');
    
    if (!stereoSection.classList.contains('hidden')) {
        // Initialize stereometer when first needed
        if (!stereometer) {
            initializeStereometer();
        }
        if (!audioPlayer.paused) {
            stereometer.start();
        }
        toggleButton.classList.add('active');
    } else {
        if (stereometer) {
            stereometer.stop();
        }
        toggleButton.classList.remove('active');
    }
});

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
    
    trackTitle.textContent = 'NO TRACK SELECTED';
    timeDisplay.textContent = '0:00 / 0:00';
    progressSlider.value = 0;
    progressSlider.style.setProperty('--value', '0%');
    
    const playlistHeaderContent = playlistHeader.querySelector('span');
    if (playlistHeaderContent) {
        playlistHeaderContent.textContent = 'PLAYLIST EMPTY';
    }
    playlistContent.innerHTML = '';
    
    // Stop visualizer 
    if (!stereoSection.classList.contains('hidden')) {
        stereometer.stop();
    }
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
        playlistHeaderContent.textContent = playlist.length > 0 ? 'PLAYLIST' : 'PLAYLIST EMPTY';
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

    // LOOP off when skipped
    if (isLoopEnabled) {
        isLoopEnabled = false;
        loopButton.classList.remove('active');
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
            
            if (!stereoSection.classList.contains('hidden')) {
                stereometer.start();
            }
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
            if (!stereoSection.classList.contains('hidden')) {
                stereometer.start();
            }
            log('Playback started');
        } else {
            audioPlayer.pause();
            playButton.textContent = '⏵';
            isPlaying = false;
            stopProgressUpdate();
            if (stereometer) {
                stereometer.stop();
            }
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