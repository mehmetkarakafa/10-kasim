# 10 Kasım – Bir Milletin Hafızası

Mustafa Kemal Atatürk'ün 100 tarihî fotoğrafının, karanlıktan süzülerek tek bir büyük Atatürk portresinde birleştiği dijital anma eseri.

Proje HTML, CSS, Vanilla JavaScript ve Canvas API ile yazıldı. Framework, kütüphane veya derleme adımı gerektirmez.

## Çalıştırma

Klasörde yerel bir sunucu başlatın:

```bash
python -m http.server 8080
```

Sonra tarayıcıda `http://localhost:8080` adresini açın. VS Code kullanıyorsanız Live Server eklentisi de iş görür.

> `index.html` dosyasına çift tıklayarak da açılabilir. Ancak tarayıcılar `file://` altında piksel okumayı engellediği için mozaik sadeleştirilmiş modda çizilir. En iyi sonucu sunucuyla alırsınız.

## Deneyimin akışı

1. **Açılış:** Siyah ekran, film grain ve sırayla beliren metinler. Fotoğraflar bu sırada arka planda yüklenir.
2. **Mozaik:** Butona basıldığında kısa bir karanlık olur, ardından 100 fotoğraf ekranın dört bir yanından süzülerek gelir. Portrenin aydınlık bölgeleri, yani yüz, önce oluşur; gölgeler sonra dolar. Bütün kareler yerine oturunca portrenin üzerinden tek bir yumuşak ışık geçer.
3. **İnceleme:** Portre tamamlanınca üzerinde gezinmek bir büyüteç açar ve yakından bakınca 100 fotoğraf görünür. Bir kareye tıklamak o fotoğrafı yılı ve kaynağıyla birlikte açar.
4. **Anma:** 10 Kasım 1938, büyük 09:05 tipografisi ve anma metni.
5. **Kaynaklar:** 100 fotoğrafın tamamı, kaynak sayfalarına bağlantılarıyla listelenir.

## Mozaik nasıl çalışıyor? (`js/mosaic.js`)

Fotoğraflar rastgele dizilmiyor. Her kare, büyük portrenin denk geldiği bölgeyi temsil ediyor:

1. Her fotoğraf yüzü koruyacak şekilde kare kırpılır (üst kısma ağırlık verilir) ve griye çevrilir.
2. Her fotoğrafın ortalama parlaklığı ile **4×4'lük ton imzası** çıkarılır. Ton imzası, ışığın karenin neresinde toplandığını gösterir.
3. Ana portreye otomatik seviye ayarı, ton eğrisi ve kenarlarda siyaha eriyen bir vinyet uygulanır. Ardından portre ızgaraya bölünür ve her hücrenin de ton imzası hesaplanır.
4. Her hücreye imzası en çok benzeyen fotoğraf atanır. Bunu üç kural dengeler:
   - Hiçbir fotoğraf ortalamanın 1,8 katından fazla kullanılmaz.
   - Komşu hücrelerde aynı fotoğraf tekrar etmez.
   - Az kullanılan fotoğraflara öncelik verilir.

   100 fotoğrafın hepsi portrede yer alır.
5. Seçilen fotoğrafın parlaklığı hücrenin ortalama tonuna eşitlenir. Fotoğrafın kendi ayrıntısı korunur ve portrenin ince çizgileriyle (gözler, ağız) hafifçe harmanlanır.
6. Sonuç iki tuvale yazılır: biri büyüteç için yüksek çözünürlüklü, biri ekran için. Animasyon her kare için tek bir `drawImage` çağrısı yapar. Yerine oturan kareler ayrı bir katmana işlenir, böylece her karede yalnızca hareket eden kareler yeniden çizilir.

Hücre sayısı ekrana göre değişir: telefonda 30, tablette 40, masaüstünde 46 sütun.

## Fotoğraflar ve lisans

- `assets/ataturk/ataturk-001.jpg` … `ataturk-100.jpg`: 1900–1938 arasından 100 tarihî fotoğraf, eskiden yeniye sıralı. Askerî üniforma, sivil kıyafet, portreler ve tarihî anlar karışık. Oranları korunarak en fazla 440 px'e küçültüldüler.
- `assets/images/ataturk-main.jpg`: Ana portre. Hollanda Ulusal Arşivi'ndeki 1925–1938 dönemine ait stüdyo portresi.
- Fotoğrafların hepsi **Wikimedia Commons**'tan alındı. Hepsi orada **kamu malı (public domain)** olarak işaretli. Resim, çizim, gazete sayfası, pul ve renklendirilmiş kareler elendi.
- Her fotoğrafın başlığı, yılı, lisansı ve kaynak bağlantısı `js/photo-data.js` dosyasında. Bu bilgiler sitenin "Fotoğraf kaynakları" bölümünde ve inceleme panelinde de gösteriliyor.

> Klasör adı Türkçe karakter içermemesi için `ataturk` olarak bırakıldı. `ü` harfi bazı sunucularda ve URL'lerde sorun çıkarabiliyor.

## Hata durumları

- Bir fotoğraf yüklenemezse o kare nötr bir dokuyla değiştirilir ve mozaikte kullanılmaz. Fotoğraf gibi gösterilen sahte bir görsel üretilmez.
- Ana portre yüklenemezse, yüklenebilen ilk tarihî portre hedef olarak kullanılır.
- Hiçbir şey yüklenemezse mozaik bölümü gizlenir ve sayfa anma bölümüyle devam eder.
- Animasyon, bütün görseller yüklenmeden başlamaz. Erken basılırsa butonun altında yükleme yüzdesi görünür.

## Erişilebilirlik

- Bütün akış klavyeyle kullanılabilir: `Tab` ile başlatılır, portrede ok tuşlarıyla kareler arasında gezilir, `Enter` ile fotoğraf açılır, `Esc` ile kapanır.
- `prefers-reduced-motion` ayarı açıksa uçuş animasyonu atlanır ve portre doğrudan belirir. Grain ve diğer geçişler de kapanır.
- Müzik yok, sayfa hiçbir zaman kendiliğinden ses çalmaz.

## Dosya yapısı

```
10-kasim/
├── index.html
├── css/style.css
├── js/
│   ├── photo-data.js   # 100 fotoğrafın kaynak ve lisans bilgileri
│   ├── animations.js   # easing, film grain, kaydırma geçişleri
│   ├── mosaic.js       # fotomozaik motoru ve animasyon
│   └── main.js         # akış, etkileşim, inceleme paneli
├── assets/
│   ├── ataturk/        # ataturk-001.jpg … ataturk-100.jpg
│   └── images/ataturk-main.jpg
└── README.md
```
