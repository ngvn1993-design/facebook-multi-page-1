const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
let server;

function startServer(){
  const dataDir = app.getPath('userData');
  server = spawn(process.execPath, [path.join(__dirname,'server.js')], {
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',FB_MULTI_PAGE_DATA_DIR:dataDir},
    stdio:'ignore'
  });
}

async function createWindow(){
  startServer();
  await new Promise(r=>setTimeout(r,1500));
  const win = new BrowserWindow({
    width:1200,height:850,minWidth:900,minHeight:650,
    webPreferences:{contextIsolation:true,nodeIntegration:false},
    autoHideMenuBar:true,
    title:'Facebook Multi-Page'
  });
  await win.loadURL('http://127.0.0.1:3000');
}

app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{ if(server) server.kill(); if(process.platform!=='darwin') app.quit(); });
app.on('before-quit',()=>{if(server)server.kill();});
