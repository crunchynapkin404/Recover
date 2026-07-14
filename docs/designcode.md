Page: Recover Premium - Interactive Dashboard

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="view-transition" content="same-origin">
  <title>Recover Premium</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
    :root {
      --background: #0a0a0a;
      --foreground: #fafafa;
      --glass-bg: rgba(255, 255, 255, 0.05);
      --glass-border: rgba(255, 255, 255, 0.1);
      --viz-ready: #10b981;
      --viz-warning: #f59e0b;
      --viz-critical: #ef4444;
      --viz-strain: #3b82f6;
      --font-sans: 'Geist', sans-serif;
    }
    body {
      font-family: var(--font-sans);
      background-color: var(--background);
      color: var(--foreground);
      margin: 0;
      -webkit-font-smoothing: antialiased;
      letter-spacing: -0.01em;
      font-size: 15px;
      overflow-x: hidden;
    }
    .glass {
      background: var(--glass-bg);
      backdrop-filter: blur(24px);
      border: 1px solid var(--glass-border);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
    }
    @media (hover: hover) {
      .glass:hover {
        transform: translateY(-4px);
        box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);
      }
    }
    .mesh-gradient {
      background: 
        radial-gradient(at 10% 10%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
        radial-gradient(at 90% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 40%),
        radial-gradient(at 50% 50%, #0a0a0a 100%);
    }
    .hero-pulse {
      animation: pulse-glow 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes pulse-glow {
      0%, 100% { opacity: 0.3; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.15); }
    }
    .hide-scrollbar::-webkit-scrollbar { display: none; }
    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    
    .nav-active-dot {
      position: absolute;
      bottom: -4px;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 0 12px white;
      animation: breathe 3s ease-in-out infinite;
    }
    @keyframes breathe {
      0%, 100% { transform: scale(1); opacity: 0.6; }
      50% { transform: scale(1.3); opacity: 1; }
    }

    /* (1) READINESS RING ANIMATION */
    .ring-animate {
      stroke-dasharray: 276;
      stroke-dashoffset: 276;
      animation: ring-draw 1.2s cubic-bezier(0.65, 0, 0.35, 1) forwards;
    }
    @keyframes ring-draw {
      to { stroke-dashoffset: var(--target-offset); }
    }

    /* (2) VITAL SPARKLINES */
    .sparkline-animate path {
      stroke-dasharray: 200;
      stroke-dashoffset: 200;
      animation: draw-path 1.2s ease-out forwards;
    }
    @keyframes draw-path {
      to { stroke-dashoffset: 0; }
    }

    /* (3) SCROLL REVEAL */
    .reveal {
      opacity: 0;
      transform: translateY(24px);
      transition: all 0.7s cubic-bezier(0.21, 1.02, 0.49, 1);
    }
    .reveal.active {
      opacity: 1;
      transform: translateY(0);
    }

    /* (4) MISC */
    .trend-arrow-animate {
      animation: arrow-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
    @keyframes arrow-bounce {
      0% { transform: translateY(4px); opacity: 0; }
      60% { transform: translateY(-2px); }
      100% { transform: translateY(0); opacity: 1; }
    }
    .ai-sparkle {
      animation: rotate-shimmer 8s linear infinite;
    }
    @keyframes rotate-shimmer {
      from { transform: rotate(0deg); filter: hue-rotate(0deg); }
      to { transform: rotate(360deg); filter: hue-rotate(30deg); }
    }
    
    .clip-reveal {
      clip-path: inset(0 100% 0 0);
      animation: reveal-clip 1.5s cubic-bezier(0.65, 0, 0.35, 1) forwards;
    }
    @keyframes reveal-clip {
      to { clip-path: inset(0 0 0 0); }
    }

    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="min-h-screen mesh-gradient relative pb-32 pt-[env(safe-area-inset-top)]">
    
    <!-- Background Parallax Blobs -->
    <div class="fixed inset-0 pointer-events-none z-0">
      <div class="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-emerald-500/5 to-transparent" style="transform: translateY(calc(var(--scroll-y, 0) * -0.05px))"></div>
    </div>

    <!-- (1) HEADER -->
    <header class="pt-8 px-6 mb-8 relative z-10 flex justify-between items-start reveal" id="header">
      <div class="flex flex-col">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[11px] uppercase tracking-[0.2em] text-white/50 font-bold">Monday, June 12</span>
          <iconify-icon icon="lucide:cloud-sun" class="text-white/40 text-sm"></iconify-icon>
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-white/90">Good morning, Bart</h1>
      </div>
      <a id="nav-profile-link" href="#" class="touch-target rounded-full glass">
        <iconify-icon icon="lucide:user" class="text-xl text-white/80"></iconify-icon>
      </a>
    </header>

    <!-- (2) HERO TRIFECTA -->
    <section class="px-6 mb-8 relative z-10 flex flex-col items-center reveal" id="hero">
      <div class="flex items-end justify-center gap-4 mb-6">
        <!-- Recovery (Left) -->
        <div class="flex flex-col items-center gap-3 mb-4">
          <div class="relative w-20 h-20">
            <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="#10b981" stroke-width="6" stroke-dasharray="264" style="--target-offset: calc(264 - (264 * 0.82))" class="ring-animate" stroke-linecap="round" />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-xl font-bold text-white/90 counter" data-target="82">0</span>
          </div>
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold">Recovery</span>
        </div>

        <!-- Readiness (Center) -->
        <div class="relative w-44 h-44 flex flex-col items-center justify-center">
          <div class="absolute inset-0 bg-emerald-500/10 rounded-full blur-3xl hero-pulse"></div>
          <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90 relative">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="#10b981" stroke-width="4.5" stroke-dasharray="276" style="--target-offset: calc(276 - (276 * 0.91))" class="ring-animate" stroke-linecap="round" class="drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-6xl font-bold tracking-tighter text-white counter" data-target="91">0</span>
            <span class="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 mt-1">Readiness</span>
          </div>
        </div>

        <!-- Strain (Right) -->
        <div class="flex flex-col items-center gap-3 mb-4">
          <div class="relative w-20 h-20">
            <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="#3b82f6" stroke-width="6" stroke-dasharray="264" style="--target-offset: calc(264 - (264 * (5.8/21)))" class="ring-animate" stroke-linecap="round" />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-xl font-bold text-white/90">5.8</span>
          </div>
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold">Strain</span>
        </div>
      </div>
      <p class="text-[13px] font-medium text-emerald-400 flex items-center gap-1.5">
        <iconify-icon icon="lucide:check-circle" class="text-sm"></iconify-icon>
        Recovery strong · Low strain · Ready for intensity
      </p>
    </section>

    <!-- (3) STRAIN BUDGET BAR -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass rounded-2xl p-5">
        <div class="flex justify-between items-center mb-3">
          <span class="text-[11px] uppercase tracking-wider font-bold text-white/50">Strain Budget</span>
          <span class="text-xs font-bold text-white/80"><span class="counter" data-target="8.4">0</span>.4 remaining <span class="text-white/40 font-normal">of 14.2</span></span>
        </div>
        <div class="h-2.5 w-full bg-white/5 rounded-full overflow-hidden flex">
          <div class="h-full bg-blue-500 transition-all duration-1000 ease-out clip-reveal" style="width: 40%;"></div>
          <div class="h-full flex-1"></div>
        </div>
        <div class="flex justify-between mt-2 px-1">
          <div class="w-1 h-1 rounded-full bg-emerald-500 opacity-50"></div>
          <div class="w-1 h-1 rounded-full bg-amber-500 opacity-50"></div>
          <div class="w-1 h-1 rounded-full bg-red-500 opacity-50"></div>
        </div>
      </div>
    </section>

    <!-- (4) AI MORNING BRIEF -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass p-6 rounded-[2rem] border-emerald-500/20">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <iconify-icon icon="lucide:sparkles" class="text-emerald-400 text-lg ai-sparkle"></iconify-icon>
          </div>
          <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-emerald-400">Morning Insights</span>
        </div>
        <p class="text-[15px] leading-relaxed text-white/80">
          Your HRV recovered to <span class="text-emerald-400 font-semibold">52ms</span> overnight (+12% vs baseline), and your resting HR dropped to 48bpm — both strong signals. Sleep was 7.2 hours with good efficiency. You have a high strain budget today (14.2) — green light for your planned interval session. Consider a 20min easy warmup given yesterday was a rest day. Watch hydration — your RHR was slightly elevated yesterday evening.
        </p>
        <a id="cta-chat-coach" href="#" class="inline-flex items-center gap-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors">
          Chat with Coach
          <iconify-icon icon="lucide:arrow-right"></iconify-icon>
        </a>
      </div>
    </section>

    <!-- (5) VITALS GRID -->
    <section class="px-6 mb-10 relative z-10">
      <div class="grid grid-cols-2 gap-4">
        <!-- HRV -->
        <div class="glass rounded-2xl p-5 reveal">
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-3">HRV</span>
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-2xl font-bold text-white counter" data-target="52">0</span><span class="text-xs font-normal text-white/40 ml-1">ms</span>
            <iconify-icon icon="lucide:arrow-up" class="text-emerald-400 text-sm trend-arrow-animate"></iconify-icon>
          </div>
          <p class="text-[10px] text-white/40 mb-3">7d avg: 48ms</p>
          <div class="h-8 sparkline-animate">
            <svg viewBox="0 0 100 20" class="w-full h-full opacity-40"><path d="M0 15 Q10 12 20 16 T40 8 T60 12 T80 4 T100 10" fill="none" stroke="#10b981" stroke-width="2"/></svg>
          </div>
        </div>
        <!-- RHR -->
        <div class="glass rounded-2xl p-5 reveal">
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-3">Resting HR</span>
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-2xl font-bold text-white counter" data-target="48">0</span><span class="text-xs font-normal text-white/40 ml-1">bpm</span>
            <iconify-icon icon="lucide:arrow-down" class="text-emerald-400 text-sm trend-arrow-animate"></iconify-icon>
          </div>
          <p class="text-[10px] text-white/40 mb-3">7d avg: 51bpm</p>
          <div class="h-8 sparkline-animate">
            <svg viewBox="0 0 100 20" class="w-full h-full opacity-40"><path d="M0 5 Q10 8 20 4 T40 12 T60 8 T80 16 T100 12" fill="none" stroke="#10b981" stroke-width="2"/></svg>
          </div>
        </div>
        <!-- Sleep Score -->
        <div class="glass rounded-2xl p-5 reveal">
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-3">Sleep Score</span>
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-2xl font-bold text-white counter" data-target="88">0</span><span class="text-xs font-normal text-white/40 ml-1">/100</span>
            <iconify-icon icon="lucide:minus" class="text-white/30 text-sm"></iconify-icon>
          </div>
          <p class="text-[10px] text-white/40 mb-3">Efficiency: 92%</p>
          <div class="h-8 sparkline-animate">
            <svg viewBox="0 0 100 20" class="w-full h-full opacity-40"><path d="M0 10 H20 L30 15 L50 5 L70 12 L85 8 L100 10" fill="none" stroke="#3b82f6" stroke-width="2"/></svg>
          </div>
        </div>
        <!-- Training Status -->
        <div class="glass rounded-2xl p-5 reveal">
          <span class="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-3">Training Status</span>
          <div class="flex flex-col gap-2">
            <div class="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider py-1.5 px-3 rounded-full w-fit">
              Productive
            </div>
            <p class="text-[10px] text-white/40">Optimal load intensity</p>
          </div>
        </div>
      </div>
    </section>

    <!-- (6) BODY BATTERY CURVE -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass rounded-[2rem] p-7 overflow-hidden">
        <div class="flex justify-between items-center mb-6">
          <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-white/50">Body Battery Curve</span>
          <span class="text-xs font-bold text-white/80">64% currently</span>
        </div>
        <div class="h-[180px] w-full relative">
          <svg viewBox="0 0 400 180" preserveAspectRatio="none" class="w-full h-full clip-reveal">
            <defs>
              <linearGradient id="energy-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.3" />
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 40 Q50 30 80 45 L120 120 L160 140 Q200 130 250 110 L300 80 L400 90" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
            <path d="M0 40 Q50 30 80 45 L120 120 L160 140 Q200 130 250 110 L300 80 L400 90 L400 180 L0 180 Z" fill="url(#energy-grad)" />
            
            <!-- Annotations -->
            <circle cx="120" cy="120" r="4" fill="#ef4444" />
            <circle cx="300" cy="80" r="4" fill="#10b981" />
          </svg>
          <div class="absolute top-[110px] left-[60px] text-[10px] text-red-400 font-bold bg-black/60 px-1.5 py-0.5 rounded opacity-0 reveal-child transition-opacity duration-500 delay-500">🏃 Run -22</div>
          <div class="absolute top-[60px] left-[260px] text-[10px] text-emerald-400 font-bold bg-black/60 px-1.5 py-0.5 rounded opacity-0 reveal-child transition-opacity duration-500 delay-1000">😴 Sleep +65</div>
        </div>
        <div class="flex justify-between mt-4 text-[10px] text-white/30 font-bold uppercase tracking-widest">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>NOW</span>
        </div>
      </div>
    </section>

    <!-- (7) SLEEP CARD -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass rounded-[2rem] p-7">
        <div class="flex justify-between items-center mb-6">
          <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-white/50">Last Night's Sleep</span>
          <span class="text-xs font-bold text-white/80">88 Score</span>
        </div>
        <!-- Stacked Bar Chart -->
        <div class="h-5 w-full flex rounded-full overflow-hidden mb-6">
          <div class="h-full w-[8%] bg-red-500/80 transition-all duration-700 delay-0 clip-reveal"></div>
          <div class="h-full w-[20%] bg-indigo-500 transition-all duration-700 delay-100 clip-reveal"></div>
          <div class="h-full w-[25%] bg-blue-500 transition-all duration-700 delay-200 clip-reveal"></div>
          <div class="h-full flex-1 bg-sky-400 transition-all duration-700 delay-300 clip-reveal"></div>
        </div>
        <div class="grid grid-cols-2 gap-y-6 gap-x-12 mb-8">
          <div>
            <p class="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Duration</p>
            <p class="text-xl font-bold text-white">7h 12m</p>
          </div>
          <div>
            <p class="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Efficiency</p>
            <p class="text-xl font-bold text-white">92%</p>
          </div>
        </div>
        <div class="bg-white/5 rounded-2xl p-4 border border-white/5">
          <p class="text-[12px] text-white/80">
            <iconify-icon icon="lucide:moon" class="text-indigo-400 mr-2"></iconify-icon>
            Optimal bedtime tonight: <span class="font-bold text-indigo-400">22:30 - 23:00</span>
          </p>
        </div>
      </div>
    </section>

    <!-- (8) BEHAVIOR JOURNAL TAGS -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass rounded-[2rem] p-7">
        <div class="flex justify-between items-center mb-5">
          <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-white/50">Yesterday's Behaviors</span>
          <a id="btn-log-behaviors" href="#" class="text-[11px] font-bold text-emerald-400 uppercase">+ Log</a>
        </div>
        <div class="flex flex-wrap gap-2.5 mb-6">
          <button class="px-4 py-2 rounded-full glass border-white/10 flex items-center gap-2 active:scale-95 transition-transform">
            <span class="text-xs">☕</span>
            <span class="text-xs font-semibold text-white/90">Caffeine</span>
          </button>
          <button class="px-4 py-2 rounded-full glass border-white/10 flex items-center gap-2 active:scale-95 transition-transform">
            <span class="text-xs">🍷</span>
            <span class="text-xs font-semibold text-white/90">Alcohol</span>
          </button>
          <button class="px-4 py-2 rounded-full glass border-white/10 flex items-center gap-2 active:scale-95 transition-transform bg-white/10">
            <span class="text-xs">📱</span>
            <span class="text-xs font-semibold text-white/90">Screen time</span>
          </button>
        </div>
      </div>
    </section>

    <!-- (11) WEEKLY SUMMARY CARD -->
    <section class="px-6 mb-10 relative z-10 reveal">
      <div class="glass rounded-[2.5rem] p-7">
        <div class="flex justify-between items-center mb-8">
          <div class="flex flex-col">
            <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-white/50">This Week</span>
            <span class="text-xs font-bold text-emerald-400 mt-1">12-day logging streak 🔥</span>
          </div>
          <!-- Small Rings (Apple Watch Style) -->
          <div class="relative w-16 h-16">
            <svg viewBox="0 0 100 100" class="w-full h-full">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(16,185,129,0.1)" stroke-width="12" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" stroke-width="12" stroke-dasharray="252" style="--target-offset: calc(252 - (252 * 0.7))" class="ring-animate" stroke-linecap="round" transform="rotate(-90 50 50)" />
              
              <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(59,130,246,0.1)" stroke-width="12" />
              <circle cx="50" cy="50" r="26" fill="none" stroke="#3b82f6" stroke-width="12" stroke-dasharray="164" style="--target-offset: calc(164 - (164 * 0.8))" class="ring-animate delay-200" stroke-linecap="round" transform="rotate(-90 50 50)" />
            </svg>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-y-6">
          <div class="flex flex-col">
            <span class="text-xl font-bold text-white">5 Workouts</span>
            <span class="text-[10px] text-white/40 font-bold uppercase tracking-tight">8.2h Total volume</span>
          </div>
          <div class="flex flex-col">
            <span class="text-xl font-bold text-white">342 Load</span>
            <span class="text-[10px] text-white/40 font-bold uppercase tracking-tight">Avg Training load</span>
          </div>
        </div>
      </div>
    </section>

    <!-- (14) BOTTOM NAVIGATION -->
    <nav class="fixed bottom-0 left-0 right-0 glass px-6 pt-3 pb-[calc(1.2rem+env(safe-area-inset-bottom))] flex justify-between items-center z-50 shadow-2xl border-t border-white/10 h-[calc(76px+env(safe-area-inset-bottom))]">
      <a href="#" id="nav-home" class="flex flex-col items-center gap-1.5 text-white transition-all active:scale-90 relative touch-target px-2">
        <iconify-icon icon="material-symbols:grid-view-rounded" class="text-2xl"></iconify-icon>
        <span class="text-[10px] font-bold uppercase tracking-widest">Home</span>
        <span class="nav-active-dot"></span>
      </a>
      <a href="#" id="nav-log" class="flex flex-col items-center gap-1.5 text-white/50 hover:text-white transition-all active:scale-90 touch-target px-2">
        <iconify-icon icon="lucide:pen-line" class="text-2xl"></iconify-icon>
        <span class="text-[10px] font-bold uppercase tracking-widest">Log</span>
      </a>
      <a href="#" id="nav-coach" class="flex flex-col items-center gap-1.5 text-white/50 hover:text-white transition-all active:scale-90 touch-target px-2">
        <iconify-icon icon="lucide:sparkles" class="text-2xl"></iconify-icon>
        <span class="text-[10px] font-bold uppercase tracking-widest">Coach</span>
      </a>
      <a href="#" id="nav-journal" class="flex flex-col items-center gap-1.5 text-white/50 hover:text-white transition-all active:scale-90 touch-target px-2">
        <iconify-icon icon="lucide:book-open" class="text-2xl"></iconify-icon>
        <span class="text-[10px] font-bold uppercase tracking-widest">Journal</span>
      </a>
      <a href="#" id="nav-settings" class="flex flex-col items-center gap-1.5 text-white/50 hover:text-white transition-all active:scale-90 touch-target px-2">
        <iconify-icon icon="lucide:settings-2" class="text-2xl"></iconify-icon>
        <span class="text-[10px] font-bold uppercase tracking-widest">Menu</span>
      </a>
    </nav>

  </div>

  <script>
    // Intersection Observer for Scroll Reveals
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          
          // Trigger count-up numbers in this card
          const counters = entry.target.querySelectorAll('.counter');
          counters.forEach(counter => animateCounter(counter));
          
          // Unobserve after activation
          revealObserver.unobserve(entry.target);
        }
      });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

    // Number Counter Animation
    function animateCounter(el) {
      const target = parseFloat(el.getAttribute('data-target'));
      const duration = 1500;
      const startTime = performance.now();
      
      function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic Ease Out
        
        const current = (easeProgress * target).toFixed(target % 1 === 0 ? 0 : 1);
        el.textContent = current;
        
        if (progress < 1) {
          requestAnimationFrame(update);
        }
      }
      requestAnimationFrame(update);
    }

    // Initial header/hero reveal if in viewport
    window.addEventListener('DOMContentLoaded', () => {
      document.getElementById('header').classList.add('active');
      document.getElementById('hero').classList.add('active');
      
      // Parallax scroll variable
      window.addEventListener('scroll', () => {
        document.documentElement.style.setProperty('--scroll-y', window.scrollY);
      });
    });
  </script>
</body>
</html>
```

Please reference this design and implement it into our codebase; Try to understand the structure, which part of our codebase is relevant and implement
