function loadFontStylesheet(id: string, href: string): void {
  if (document.getElementById(id)) return;
  const stylesheet = document.createElement('link');
  stylesheet.id = id;
  stylesheet.rel = 'stylesheet';
  stylesheet.href = href;
  document.head.appendChild(stylesheet);
}

export function loadWebLocaleFont(locale: 'en' | 'zh'): void {
  if (locale === 'zh') {
    loadFontStylesheet('nimi-font-chinese', 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
  }
}

export function loadOddBureauFont(): void {
  loadFontStylesheet('nimi-font-odd-bureau', 'https://fonts.googleapis.com/css2?family=ZCOOL+QingKe+HuangYou&display=swap');
}
