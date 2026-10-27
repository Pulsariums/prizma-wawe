# Prizma Wawe

Sıkıştırılmış müziğin (AAC, Opus, MP3) kodekle kaybolan yüksek frekanslarını geri getiren, tamamen tarayıcıda çalışan açık kaynak bir araç. Dosya hiçbir yere yüklenmez.

- **Web sitesi**: GitHub Pages üzerinde. Müzik dosyası yükle, iyileştir, önce/sonra dinle, WAV indir.
- **Chrome eklentisi** (`extension/`): Dosya modu ve sekme sesi için gecikmeli canlı mod. Pages akışı `prizma-wawe-extension.zip` dosyasını site adresinin altında üretir; zip'i aç ve "Paketlenmemiş uzantı yükle" ile klasörü seç.

## Sonuç (MUSDB doğrulama kümesi)

12 kHz üstü zarf hatası: yalnız kodek %22,2, Prizma Wawe ile %14,1. Hedef %10 henüz tutmadı; sınırı model boyutu değil eğitim verisi çeşitliliği belirliyor.

## Özellikler

- Kodek seçimi (AAC 128/96, Opus 160/128/96/64, MP3 128/192)
- Abartma: modelin düzeltmesini ×1,0 ile ×2,5 arasında büyütür (varsayılan ×1,25)
- Enhancer: stereo genişlik, sıcaklık, hava
- Şarkının istediğin bölümünü işleme

## Yayın

`.github/workflows/pages.yml` siteyi kurar: ONNX Runtime Web ve model kuruluş sırasında indirilir, depoda ikili dosya yoktur. Actions sekmesinden "Pages" akışını elle de başlatabilirsin.

Not: eklentideki "Anlık (eski model)" modu `extension/model/c_dyn.onnx` dosyasını ister; bu dosya depoda yoktur. Yeni model modları buna ihtiyaç duymaz.

## Lisans

Kod ve model ticari olmayan kullanım içindir (CC BY-NC 4.0). Model MUSDB18-HQ verisiyle eğitildi.
