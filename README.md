# حُرّاس الخلية · Cell Guardians

مغامرة علمية ثلاثية الأبعاد باللغة العربية، تُلعب في المتصفح **وحدك أو مع أصدقائك أونلاين** (حتى 6 لاعبين في الغرفة).

**▶️ العب الآن:** https://modus-consulting-sa.github.io/cell-guardians/

---

## فكرة اللعبة

أنتم فريق من المستكشفين داخل عالم مجهري. في كل عالم:

1. اجمعوا **البلّورات المضيئة** المنتشرة قرب العضيّات؛ كل بلّورة تفتح حقيقة علمية تُحفظ في **سجل الحقائق**.
2. عند اكتمال الدلائل توجّهوا إلى **البوابة** وأجيبوا عن **3 أسئلة** لفتح أقفالها الثلاثة.
3. ادخلوا البوابة لينتقل الفريق كله إلى العالم التالي.

احذروا الأعداء المتجوّلين (الفيروسات، الجذور الحرّة، سحب التلوث)، وابحثوا عن **الدليل السرّي** فوق المنصّات في كل عالم.

| العالم | الموضوع |
| --- | --- |
| ١ · الخلية النباتية | النواة، البلاستيدات الخضراء، الميتوكوندريا، الفجوة العصارية، الجدار والغشاء الخلوي، الرايبوسومات |
| ٢ · داخل الميتوكوندريا | الغشاء الخارجي، الأعراف، الحشوة، ATP، معادلة التنفس الخلوي (متاهة بين الأعراف) |
| ٣ · النظام البيئي | الشمس، المنتجات، المستهلكات الأولية والثانوية، المحلِّلات، الشبكة الغذائية، هرم الطاقة |

## اللعب الجماعي

- اضغط **«ابدأ مغامرة جديدة»** فتحصل على رمز غرفة من 4 أحرف.
- اضغط **«🔗 دعوة أصدقاء»** وأرسل الرابط؛ من يفتحه يدخل غرفتك مباشرة.
- كل دليل يجمعه أي لاعب يُحسب للفريق، والجميع يرى الآخرين يتحركون مع أسمائهم، وهناك دردشة (Enter) وفقاعات كلام فوق الرؤوس.
- إذا خرج المضيف، يتولّى لاعب آخر الاستضافة تلقائيًا ويكمل الفريق من حيث توقف.

## التحكم

| الكمبيوتر | الجوال |
| --- | --- |
| `W A S D` / الأسهم: حركة | اسحب يسار الشاشة: حركة |
| الفأرة (انقر ثم حرّك): الكاميرا | اسحب يمين الشاشة: الكاميرا |
| `Space`: قفز · `Shift`: ركض | زر ⤒: قفز · دفع العصا للآخر: ركض |
| `E`: تفاعل · `Enter`: دردشة · `J`: السجل · `H`: تلميح · `M`: الصوت | زر ✋: تفاعل |

---

## English

**Cell Guardians** is an Arabic-language 3D educational co-op game. Explore a plant cell, the inside of a mitochondrion and a forest ecosystem; collect glowing clue crystals (science facts), answer the gate quiz together and travel through the portal. Up to 6 players per room.

### Tech

- **JavaScript (ES modules) + HTML/CSS**, no build step: open `index.html` from any static host.
- **Three.js r187** for 3D: ACES tone mapping, HDR bloom, PCF shadows, custom GLSL shaders (fresnel membranes, swirling portal, sky dome, light beams, particles, wind-blown instanced grass), procedurally generated textures, procedural low-poly characters.
- **PeerJS (WebRTC)** for real-time multiplayer: one player hosts the room and is authoritative for shared state (clues, quiz locks, score, world); everyone streams their position at 15 Hz. Rooms are addressed by a 4-character code, so an invite is just `?room=CODE`. Automatic host migration if the host leaves. PeerJS's free public broker handles signalling; its TURN relays help players behind strict NATs.
- **Web Audio**: all music and sound effects are synthesized at runtime (no audio files).

### Project layout

```
index.html          page, HUD and lobby markup
css/style.css       UI styling (desktop + phone layouts)
js/main.js          game rules, multiplayer protocol, HUD, minimap, chat, quiz, journal
js/env.js           the three worlds: layouts, organelles, colliders, gate, clues, hazards
js/fx.js            renderer, post-processing, shaders, procedural textures, particles
js/character.js     explorer avatar + name tags / chat bubbles
js/controller.js    input (keyboard, mouse, touch), movement physics, camera
js/net.js           PeerJS rooms, host/client connections, watchdogs
js/audio.js         procedural music and sound effects
js/content.js       Arabic educational content (facts and quiz questions)
vendor/             Three.js (MIT) and PeerJS (MIT)
```

### Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

### Licenses

Game code: MIT. Bundled libraries: [Three.js](https://github.com/mrdoob/three.js) (MIT), [PeerJS](https://github.com/peers/peerjs) (MIT).
