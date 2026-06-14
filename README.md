# FR Legends Image to Livery Converter

Tamamen client-side çalışan bir web sürümü ve ayrıca OpenCV tabanlı bir Python dönüştürücü içerir.

## Özellikler


## Kullanım

1. `index.html` dosyasını bir static host üzerinde açın.
2. Görsel yükleyin veya sürükleyip bırakın.
3. `Convert` ile analiz edin.
4. `Copy` veya `Download TXT` ile çıktıyı alın.

## Not

Web sürümü tamamen tarayıcıda çalışır. Python sürümü için `requirements.txt` içindeki bağımlılıkları kurup `frl_converter.py` dosyasını çalıştırabilirsiniz. Codespace ve headless ortamlar için OpenCV bağımlılığı `opencv-python-headless` olarak ayarlanmıştır.

## Python Kullanımı

```bash
pip install -r requirements.txt
python frl_converter.py input.png -o output.txt
python -m unittest test_frl_converter.py
```

Çıktı formatı `SHAPE X Y W H R RGBA` şeklindedir ve tüm hexadecimal alanlar büyük harf, 4 haneli padding ve negatif koordinatlar için two's complement kuralına göre yazılır.