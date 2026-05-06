// ==========================================================================
// INDEXEDDB HELPERS  (mirrors admin.html — reads from same DB)
// ==========================================================================
const DB_NAME = 'birthday_app_db';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('timeline')) d.createObjectStore('timeline', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('gallery'))  d.createObjectStore('gallery',  { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}
function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ==========================================================================
// STATIC MEDIA (media.json) — used on Vercel so all devices see same photos
// ==========================================================================
let _staticMedia = null; // { timeline: {}, gallery: [] }

async function fetchStaticMedia() {
  try {
    const res = await fetch('media.json?v=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    // Only use if it actually has content
    const hasTimeline = Object.keys(data.timeline || {}).length > 0;
    const hasGallery  = (data.gallery || []).length > 0;
    if (hasTimeline || hasGallery) _staticMedia = data;
  } catch { /* no media.json or fetch failed — use IndexedDB */ }
}

// ==========================================================================
// APPLY TIMELINE IMAGES — media.json first, then IndexedDB fallback
// ==========================================================================
async function applyTimelineMedia() {
  const slots = document.querySelectorAll('img[data-slot]');
  for (const img of slots) {
    const slotKey = img.getAttribute('data-slot');
    const wrap = img.closest('.timeline-img-wrap');

    // 1. Check media.json (Vercel static)
    if (_staticMedia && _staticMedia.timeline && _staticMedia.timeline[slotKey]) {
      const entry = _staticMedia.timeline[slotKey];
      if (entry.type === 'video') {
        const vid = document.createElement('video');
        vid.src = entry.src; vid.autoplay = true; vid.muted = true;
        vid.loop = true; vid.playsInline = true; vid.className = 'timeline-img';
        img.replaceWith(vid);
      } else {
        img.src = entry.src;
        wrap.style.background = 'none';
      }
      continue;
    }

    // 2. Fall back to IndexedDB (local preview)
    const item = await dbGet('timeline', slotKey);
    if (!item) continue;
    const url = URL.createObjectURL(item.blob);
    if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.src = url; vid.autoplay = true; vid.muted = true;
      vid.loop = true; vid.playsInline = true; vid.className = 'timeline-img';
      img.replaceWith(vid);
    } else {
      img.src = url;
      wrap.style.background = 'none';
    }
  }
}

// ==========================================================================
// BUILD GALLERY — media.json first, then IndexedDB fallback
// ==========================================================================
let _galleryItems = [];

async function buildGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';
  _galleryItems = [];

  // 1. Use media.json if available (Vercel)
  if (_staticMedia && _staticMedia.gallery && _staticMedia.gallery.length) {
    _galleryItems = _staticMedia.gallery.map(item => ({ ...item, _url: item.src }));
  } else {
    // 2. Fall back to IndexedDB (local)
    const dbItems = await dbGetAll('gallery');
    dbItems.forEach(item => {
      item._url = URL.createObjectURL(item.blob);
      _galleryItems.push(item);
    });
  }

  if (!_galleryItems.length) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <div style="font-size:3rem">📷</div>
        <p>No memories uploaded yet.<br/>Visit the <a href="admin.html">Admin Panel</a> to add photos &amp; videos!</p>
      </div>`;
    return;
  }

  _galleryItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.setAttribute('onclick', `openGallery(${i})`);
    const mediaEl = item.type === 'video'
      ? `<video src="${item._url}" muted loop autoplay playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>`
      : `<img src="${item._url}" alt="${item.caption}" loading="lazy" />`;
    div.innerHTML = `${mediaEl}
      <div class="gallery-overlay"><span>View 🔍</span></div>`;
    grid.appendChild(div);
  });
}

// ==========================================================================
// GALLERY LIGHTBOX (reads from in-memory _galleryItems built by buildGallery)
// ==========================================================================
const galleryModal = document.getElementById('gallery-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxVid = document.createElement('video');
lightboxVid.id = 'lightbox-vid';
lightboxVid.controls = true;
lightboxVid.style.cssText = 'max-height:80vh;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.5);display:none;';
lightboxImg.after(lightboxVid);

const lightboxCaption = document.getElementById('lightbox-caption');
let currentGalleryIndex = 0;

function openGallery(index) {
  if (!_galleryItems.length) return;
  currentGalleryIndex = index;
  showLightboxItem();
  galleryModal.classList.add('active');
}

function showLightboxItem() {
  if (currentGalleryIndex < 0) currentGalleryIndex = _galleryItems.length - 1;
  if (currentGalleryIndex >= _galleryItems.length) currentGalleryIndex = 0;
  const item = _galleryItems[currentGalleryIndex];
  lightboxCaption.innerText = item.caption;
  if (item.type === 'video') {
    lightboxImg.style.display = 'none';
    lightboxVid.style.display = 'block';
    lightboxVid.src = item._url;
  } else {
    lightboxVid.style.display = 'none';
    lightboxImg.style.display = 'block';
    lightboxImg.src = item._url;
  }
}

function closeGallery() { galleryModal.classList.remove('active'); lightboxVid.pause(); }
function prevGallery() { currentGalleryIndex--; showLightboxItem(); }
function nextGallery() { currentGalleryIndex++; showLightboxItem(); }

// ==========================================================================
// OPEN WHEN LETTERS (Global scope for onclick)
// ==========================================================================
const letterContents = {
  sad: {
    title: "When you're sad...",
    body: "My love, I hate knowing that you're sad. I wish I could be there right now to hold you tight and take it all away. Please remember that this feeling is temporary, but my love for you is permanent. Take a deep breath, cry if you need to, and remember that I am always in your corner. You are so strong, and I am so proud of you. Call me as soon as you can."
  },
  miss: {
    title: "When you miss me...",
    body: "I miss you too! So much that it physically aches sometimes. But distance means so little when someone means so much. Close your eyes and imagine me wrapping my arms around you from behind and kissing your cheek. That's exactly where I want to be. Look at our photos, remember our laughs, and know I'm counting down the seconds until I see you again."
  },
  sleep: {
    title: "When you can't sleep...",
    body: "Hey sleepyhead. Mind racing? It's okay. Try to relax your shoulders, unclench your jaw, and take a slow breath. Picture us in our favourite spot, wrapped in a blanket, completely safe. Nothing from today matters anymore. I am sending you all the warm, cozy, sleepy vibes. Goodnight, my beautiful angel. 🌙"
  },
  angry: {
    title: "When you're angry...",
    body: "Take a deep breath. Count to 10. Whatever is making you angry right now, your feelings are completely valid. But don't let it ruin your beautiful day. You have such a good heart, and sometimes the world tests it. I love you even when you're fuming. Vent to me if you need to. I'm always on your side."
  },
  doubt: {
    title: "When you need strength...",
    body: "You are incredible. Sometimes you forget just how amazing, capable, and intelligent you are — but I never do. I see how hard you work and how deeply you care. Don't let a hard day convince you that you aren't enough. You are more than enough. You are everything. Believe in yourself the way I believe in you. You've got this. 💪"
  },
  happy: {
    title: "When you're happy...",
    body: "Seeing you happy is my favourite thing in the entire universe. Your joy is contagious, and your smile lights up my life. Whatever is making you smile right now — enjoy it! Soak it all in. You deserve every ounce of happiness this world has to offer. I love you so much, keep smiling that beautiful smile. 🌸"
  }
};

const letterModal = document.getElementById('letter-modal');
function openLetter(type) {
  const content = letterContents[type];
  if (content) {
    document.getElementById('modal-title').innerText = content.title;
    document.getElementById('modal-body').innerHTML = `<p>${content.body}</p>`;
    letterModal.classList.add('active');
  }
}
function closeLetter() { letterModal.classList.remove('active'); }

// ==========================================================================
// KEYBOARD NAVIGATION
// ==========================================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeLetter(); closeGallery(); }
  if (galleryModal && galleryModal.classList.contains('active')) {
    if (e.key === 'ArrowLeft') prevGallery();
    if (e.key === 'ArrowRight') nextGallery();
  }
});

// ==========================================================================
// MAIN INIT (runs after DOM is ready)
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Open DB and fetch static media.json in parallel
  [db] = await Promise.all([openDB(), fetchStaticMedia()]);
  applyTimelineMedia();
  buildGallery();

  // ---- Loading screen ----
  const loadingScreen = document.getElementById('loading-screen');
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
    createFloatingHearts();
  }, 2000);

  // ---- Section scroll observer ----
  const sections = document.querySelectorAll('.section');
  const navDots = document.querySelectorAll('.nav-dot');
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active-section');
        const index = Array.from(sections).indexOf(entry.target);
        navDots.forEach(dot => dot.classList.remove('active'));
        if (navDots[index]) navDots[index].classList.add('active');
      }
    });
  }, { threshold: 0.2 });
  sections.forEach(s => sectionObserver.observe(s));

  // ---- Timeline items scroll observer ----
  const timelineItems = document.querySelectorAll('.timeline-item');
  const tlObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view'); });
  }, { threshold: 0.4 });
  timelineItems.forEach(item => tlObserver.observe(item));

  // ---- Nav dot clicks ----
  navDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const i = dot.getAttribute('data-section');
      sections[i].scrollIntoView({ behavior: 'smooth' });
    });
  });

  // ---- Begin button ----
  const beginBtn = document.getElementById('begin-btn');
  if (beginBtn) {
    beginBtn.addEventListener('click', () => sections[1].scrollIntoView({ behavior: 'smooth' }));
  }

  // ---- Music toggle ----
  const musicToggle = document.getElementById('music-toggle');
  const bgMusic = document.getElementById('bg-music');
  let isMusicPlaying = false;
  musicToggle.addEventListener('click', () => {
    if (isMusicPlaying) {
      bgMusic.pause();
      musicToggle.classList.remove('playing');
      musicToggle.innerHTML = '🎵';
    } else {
      bgMusic.play().catch(() => {});
      musicToggle.classList.add('playing');
      musicToggle.innerHTML = '⏸️';
    }
    isMusicPlaying = !isMusicPlaying;
  });

  // ---- Reasons I Love You ----
  const loveReasons = [
    "I love the way your eyes crinkle when you smile.",
    "I love how safe I feel when I'm in your arms.",
    "I love your laugh — it's my favourite sound in the world.",
    "I love how fiercely you care about the people you love.",
    "I love the way you look at me when you think I'm not looking.",
    "I love our late-night conversations about everything and nothing.",
    "I love how you inspire me to be a better person every single day.",
    "I love the little dances you do when you eat something yummy.",
    "I love how we can communicate perfectly with just a look.",
    "I love your kindness and your incredibly pure heart.",
    "I love how you remember the little things I mention in passing.",
    "I love that you are my biggest cheerleader.",
    "I love the warmth of your hand holding mine.",
    "I love that I can be completely, unapologetically myself with you.",
    "I love the way my heart skips a beat when I see your name on my phone.",
    "I love our inside jokes that make no sense to anyone else.",
    "I love how you patiently listen to my rants.",
    "I love the beautiful life we are building together.",
    "I love that you are not just my partner, but my absolute best friend.",
    "I simply love you — for all that you are, all that you've been, and all you will be."
  ];

  function shuffle(arr) {
    let a = [...arr], i = a.length;
    while (i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  let shuffled = shuffle(loveReasons);
  let reasonIndex = 0;
  const loveMessageEl = document.getElementById('love-message');
  const loveCounterEl = document.getElementById('love-counter-num');
  const heartsBar = document.getElementById('love-hearts-bar');

  loveMessageEl.innerText = 'Click the button below to see the first reason…';

  document.getElementById('love-btn').addEventListener('click', () => {
    if (reasonIndex >= shuffled.length) { shuffled = shuffle(loveReasons); reasonIndex = 0; }

    // Mini heart bar
    const mh = document.createElement('span');
    mh.className = 'mini-heart';
    mh.innerText = '💖';
    heartsBar.appendChild(mh);
    setTimeout(() => mh.classList.add('visible'), 50);
    if (heartsBar.children.length > 15) heartsBar.removeChild(heartsBar.firstChild);

    // Typing effect
    const reason = shuffled[reasonIndex];
    loveMessageEl.innerHTML = '';
    loveMessageEl.classList.add('typing-cursor');
    let i = 0;
    const tw = setInterval(() => {
      if (i < reason.length) { loveMessageEl.innerHTML += reason.charAt(i++); }
      else { clearInterval(tw); loveMessageEl.classList.remove('typing-cursor'); }
    }, 40);

    loveCounterEl.innerText = reasonIndex + 1;
    document.getElementById('love-btn-text').innerText = 'Show me another reason';
    reasonIndex++;
  });

  // ---- Surprise ----
  let surpriseClicked = false;
  document.getElementById('surprise-btn').addEventListener('click', () => {
    if (surpriseClicked) return;
    surpriseClicked = true;
    document.getElementById('surprise-gift-wrap').style.display = 'none';
    document.getElementById('surprise-btn').style.display = 'none';
    const reveal = document.getElementById('surprise-reveal');
    reveal.classList.add('active');
    fireConfetti();
    if (!isMusicPlaying) {
      bgMusic.play().catch(() => {});
      musicToggle.classList.add('playing');
      musicToggle.innerHTML = '⏸️';
      isMusicPlaying = true;
    }
  });

  function fireConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#ff69b4', '#dda0dd', '#ffb6c1', '#ffffff', '#ff1493'];
    const pieces = Array.from({ length: 150 }, () => ({
      x: canvas.width / 2, y: canvas.height / 2 + 100,
      vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 1) * 20 - 10,
      size: Math.random() * 10 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360, rotationSpeed: (Math.random() - 0.5) * 10
    }));
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let active = false;
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.5; p.rotation += p.rotationSpeed;
        if (p.y < canvas.height) active = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      if (active) requestAnimationFrame(animate);
    }
    animate();
  }
});

// ==========================================================================
// FLOATING HEARTS (Landing Section)
// ==========================================================================
function createFloatingHearts() {
  const container = document.getElementById('floating-hearts');
  if (!container) return;
  const symbols = ['❤️', '💖', '💕', '💗', '💓'];
  setInterval(() => {
    const heart = document.createElement('div');
    heart.className = 'heart-shape';
    heart.innerText = symbols[Math.floor(Math.random() * symbols.length)];
    heart.style.left = Math.random() * 100 + 'vw';
    heart.style.fontSize = (Math.random() * 2 + 1) + 'rem';
    heart.style.animationDuration = (Math.random() * 5 + 5) + 's';
    container.appendChild(heart);
    setTimeout(() => heart.remove(), 10000);
  }, 800);
}
