const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false,  
            allowRunningInsecureContent: true 
        }
    });

    mainWindow.loadFile('index.html');
}

// obslugi bledow
ipcMain.handle('select-music', async () => {
    try {
        console.log('Opening file dialog...');
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg'] }
            ]
        });
        console.log('Dialog result:', result);
        return result.filePaths;
    } catch (error) {
        console.error('Error in select-music:', error);
        throw error;
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});