import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { App } from './App.js';
import BlueYardScene from './components/blueyard-scene.js';
import BlueyardCloneScene from './components/blueyard-clone-scene.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}

// 根据路径决定渲染哪个应用
const path = window.location.pathname;

if (path === '/blueyard' || path === '/blueyard/') {
  // BlueYard 风格页面
  createRoot(rootElement).render(
    <React.StrictMode>
      <BlueYardScene />
    </React.StrictMode>,
  );
} else if (path === '/blueyard-clone' || path === '/blueyard-clone/') {
  // 1:1 复刻页面
  createRoot(rootElement).render(
    <React.StrictMode>
      <BlueyardCloneScene />
    </React.StrictMode>,
  );
} else {
  // 默认 Nimi Landing 页面
  createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>,
  );
}
