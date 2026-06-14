# FR Legends Image to Livery Converter

Tamamen client-side çalışan, GitHub Pages uyumlu bir FR Legends livery dönüştürücüsü.

## Özellikler

- PNG, JPG ve SVG yükleme
- Canvas tabanlı analiz pipeline
- Shape detection, renk çıkarımı ve FRL koordinat mapping
- 1300 layer limitine göre optimizasyon
- TXT export, clipboard copy ve download
- Dark theme, mobile-first arayüz
- PWA desteği için service worker

## Kullanım

1. `index.html` dosyasını bir static host üzerinde açın.
2. Görsel yükleyin veya sürükleyip bırakın.
3. `Convert` ile analiz edin.
4. `Copy` veya `Download TXT` ile çıktıyı alın.

## Not

Bu proje tamamen tarayıcıda çalışır. Backend, API veya server-side processing yoktur.