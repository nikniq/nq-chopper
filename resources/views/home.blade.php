@extends('layouts.app')
@section('title', 'NQ Chopper · Free helicopter rescue & strategy game in your browser')
@section('wide', true)

@section('content')
<section class="hero2">
    <div class="hero-copy">
        <p class="eyebrow">Free to play · No download · Desktop, phone &amp; tablet</p>
        <h1><span class="sr-only">NQ CHOPPER: </span>Fly in. Land hot.<br><span class="hl">Win the war.</span></h1>
        <p class="lede">
            A side-scrolling helicopter action game that grows into a real-time strategy battle.
            Rescue hostages under fire, build an army, fortify bunkers and lead the push on the enemy base.
        </p>
        <div class="cta">
            <a href="{{ route('game') }}" class="btn btn-big btn-play">&#9654; Play free now</a>
            <a href="{{ route('game', ['daily' => 1]) }}" class="btn btn-big btn-ghost">Daily Challenge</a>
        </div>
        <p class="hero-note">
            @auth
                Welcome back, <strong>{{ auth()->user()->name }}</strong>.
                @if ($personalBest) Your best: <strong>{{ number_format($personalBest) }}</strong>. @endif
                <a href="{{ route('multiplayer') }}">Play 1v1 or co-op online &rarr;</a>
            @else
                Play instantly as a guest. <a href="{{ route('register') }}">Create a free account</a> to save scores, earn achievements and play online.
            @endauth
        </p>
    </div>
    <a class="hero-shot" href="{{ route('game') }}" aria-label="Play NQ Chopper now">
        <img src="{{ asset('img/screen-4.webp') }}" alt="NQ Chopper gameplay: a rescue helicopter over a volcanic battlefield with tanks, a hostage house and the home base" width="1000" height="609" fetchpriority="high">
        <span class="play-badge" aria-hidden="true">&#9654;</span>
    </a>
</section>

@if ($totals['runs'] >= 50)
<section class="proof" aria-label="Game statistics">
    <div><strong>{{ number_format($totals['pilots']) }}</strong><span>pilots enlisted</span></div>
    <div><strong>{{ number_format($totals['runs']) }}</strong><span>missions flown</span></div>
    <div><strong>{{ number_format($totals['rescued']) }}</strong><span>hostages rescued</span></div>
    <div><strong>{{ $totals['topWave'] }}</strong><span>highest wave reached</span></div>
</section>
@endif

<section class="section">
    <header class="section-head">
        <p class="eyebrow">Why pilots keep coming back</p>
        <h2>Arcade action up front. Real strategy underneath.</h2>
    </header>
    <div class="features">
        <div class="feature"><span class="ico" aria-hidden="true">🚁</span><h3>Daring rescues</h3><p>Land beside the huts, load up to four hostages and race them home through tank fire, flak and an enemy gunship.</p></div>
        <div class="feature"><span class="ico" aria-hidden="true">🪖</span><h3>Build your army</h3><p>Spend what you earn on soldiers and tanks. Hold them back, then release them to march on the enemy together.</p></div>
        <div class="feature"><span class="ico" aria-hidden="true">🏰</span><h3>Hold the ground</h3><p>Capture houses and upgrade them to bunkers, AA sites, fortresses and citadels that pay income and fire mortars.</p></div>
        <div class="feature"><span class="ico" aria-hidden="true">🚀</span><h3>Upgrade your chopper</h3><p>Guns, armour, engine, bomb bay, flares, homing missiles and auto-repair. Every run you get stronger.</p></div>
        <div class="feature"><span class="ico" aria-hidden="true">🗓️</span><h3>A new challenge every day</h3><p>Everyone flies the same world each day. One shot at the board, resetting at midnight UTC.</p></div>
        <div class="feature"><span class="ico" aria-hidden="true">🤝</span><h3>Play with friends</h3><p>Send a link and fly 1v1 or co-op online. Two bases, two armies, one winner.</p></div>
    </div>
</section>

<section class="section">
    <header class="section-head">
        <p class="eyebrow">From rescue run to ground war</p>
        <h2>Every wave raises the stakes</h2>
    </header>
    <div class="steps">
        <figure class="step">
            <img src="{{ asset('img/screen-1.webp') }}" alt="Wave 1: the chopper leaves base over a jungle valley" width="1000" height="609" loading="lazy">
            <figcaption><span class="num">1</span><strong>Rescue.</strong> Learn to fly, dodge tanks and bring the hostages home.</figcaption>
        </figure>
        <figure class="step">
            <img src="{{ asset('img/screen-4.webp') }}" alt="Wave 4: heavy armour on a volcanic battlefield" width="1000" height="609" loading="lazy">
            <figcaption><span class="num">2</span><strong>Fight.</strong> Heavy armour, anti-air guns and homing missiles. Bombs, flares and airstrikes answer back.</figcaption>
        </figure>
        <figure class="step">
            <img src="{{ asset('img/screen-7.webp') }}" alt="Wave 7: command phase in an arctic sunset" width="1000" height="609" loading="lazy">
            <figcaption><span class="num">3</span><strong>Command.</strong> From wave 7 it's a ground war: only destroying the enemy base takes the sector.</figcaption>
        </figure>
    </div>
</section>

<section class="section">
    <header class="section-head">
        <p class="eyebrow">Choose your mission</p>
        <h2>Three ways to play</h2>
    </header>
    <div class="modes-grid">
        <a class="mode-card" href="{{ route('game') }}">
            <h3>Solo campaign</h3>
            <p>Endless waves across jungle, desert, volcanic and arctic worlds. How far can you go?</p>
            <span class="go">Play solo &rarr;</span>
        </a>
        <a class="mode-card featured" href="{{ route('game', ['daily' => 1]) }}">
            <span class="tag">Today</span>
            <h3>Daily Challenge</h3>
            <p>The same seeded world for every pilot, every day. Climb the daily board and keep your streak.</p>
            <span class="go">Fly today's challenge &rarr;</span>
        </a>
        <a class="mode-card" href="{{ auth()->check() ? route('multiplayer') : route('login') }}">
            <h3>Online 1v1 &amp; co-op</h3>
            <p>Invite a friend with a link. Duel base against base, or team up against the computer.</p>
            <span class="go">{{ auth()->check() ? 'Start a match' : 'Log in to play online' }} &rarr;</span>
        </a>
    </div>
</section>

<section class="section boards">
    <div class="leaderboard">
        <h2>Daily Challenge &middot; {{ $today }} <a class="more" href="{{ route('leaderboard', ['board' => 'daily']) }}">Archive &rarr;</a></h2>
        <p class="muted">Everyone gets the same world today. Resets at midnight UTC.
            @auth @if ($dailyBest) Your best today: <strong>{{ number_format($dailyBest) }}</strong>. @endif @endauth</p>
        @if ($dailyLeaders->isEmpty())
            <p class="muted">Nobody has flown today's challenge yet. <a href="{{ route('game', ['daily' => 1]) }}">Be first.</a></p>
        @else
            <table>
                <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th></tr></thead>
                <tbody>
                @foreach ($dailyLeaders as $i => $row)
                    <tr @class(['me' => auth()->check() && $row['user_id'] === auth()->id()])>
                        <td>{{ $i + 1 }}</td><td><a href="{{ route('profile', $row['user_id']) }}">{{ $row['name'] }}</a></td><td>{{ number_format($row['score']) }}</td><td>{{ $row['wave'] }}</td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        @endif
    </div>
    <div class="leaderboard">
        <h2>All-time leaderboard <a class="more" href="{{ route('leaderboard') }}">All boards &rarr;</a></h2>
        <p class="muted">The best solo campaigns ever flown.</p>
        @if ($leaders->isEmpty())
            <p class="muted">No scores yet. Be the first pilot on the board.</p>
        @else
            <table>
                <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th></tr></thead>
                <tbody>
                @foreach ($leaders as $i => $row)
                    <tr @class(['me' => auth()->check() && $row['user_id'] === auth()->id()])>
                        <td>{{ $i + 1 }}</td><td><a href="{{ route('profile', $row['user_id']) }}">{{ $row['name'] }}</a></td><td>{{ number_format($row['score']) }}</td><td>{{ $row['wave'] }}</td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        @endif
    </div>
</section>

<section class="section faq">
    <header class="section-head">
        <p class="eyebrow">Questions</p>
        <h2>Before you take off</h2>
    </header>
    <details><summary>Is NQ Chopper really free?</summary><p>Yes. The whole game is free to play in your browser. There is nothing to buy and nothing to install.</p></details>
    <details><summary>What do I need to play?</summary><p>Any modern browser on a computer, phone or tablet. Play with keyboard, mouse or touch. On phones, add it to your home screen for full-screen play.</p></details>
    <details><summary>Do I need an account?</summary><p>No. Guests can play right away. A free account saves your scores to the leaderboards, tracks your stats and achievements, and unlocks online multiplayer. You can sign in with Google or your nikniq.com account.</p></details>
    <details><summary>How does the Daily Challenge work?</summary><p>Every pilot flies the same seeded world for the day, so the board is a fair contest. It resets at midnight UTC.</p></details>
</section>

<section class="final-cta">
    <h2>Your chopper is fuelled and waiting.</h2>
    <p>One click and you're in the air. No download, no sign-up needed.</p>
    <a href="{{ route('game') }}" class="btn btn-big btn-play">&#9654; Play free now</a>
    @guest <p class="muted small">Want your scores saved? <a href="{{ route('register') }}">Create a free account</a> &middot; <a href="{{ route('login') }}">Log in</a></p> @endguest
</section>

<section class="section manual" id="manual">
    <details>
        <summary><h2>Field manual: controls &amp; rules</h2></summary>
    <ul>
        <li><kbd>Arrows</kbd> / <kbd>WASD</kbd> fly &middot; <kbd>Space</kbd> shoot &middot; <kbd>B</kbd> bomb &middot; hold <kbd>G</kbd> for the jet booster (meter recharges after a pause) &middot; <kbd>V</kbd> fires a homing air-to-air missile (four carried, rearm at base)</li>
        <li>Every wave raises the threat level: tougher armour, harder-hitting shells, a richer enemy war chest and a gunship every third wave.</li>
        <li><strong>Command phase (wave 7 on):</strong> the war goes to the ground. A wave is won only by destroying the enemy base, so build an army, hold it with <kbd>6</kbd> until it is strong, then release it to advance together. Your troops become veterans that scale with the threat, your troop limit grows each wave, bunkers pay you income, and hostages (fewer now) still earn cash and points.</li>
        <li>Solo runs start with two spare choppers. Crash and you redeploy at base (anyone aboard is lost); clearing a gunship wave earns another spare, up to four.</li>
        <li><kbd>1</kbd> buy a soldier ($50) &middot; <kbd>2</kbd> buy a tank ($200) &middot; <kbd>3</kbd> upgrade guns &middot; <kbd>4</kbd> upgrade armour</li>
        <li>From wave 2, a starred VIP pays a big bonus, and wounded hostages (red cross) move slowly and only last 60 seconds once you land nearby.</li>
        <li>Chain kills quickly for a combo multiplier of up to 3&times; points.</li>
        <li><kbd>5</kbd> call an airstrike ($250) &middot; <kbd>6</kbd> hold or release your troops at your position &middot; <kbd>8</kbd> engine, <kbd>9</kbd> bomb bay, <kbd>0</kbd> auto-repair upgrades &middot; <kbd>7</kbd> load soldiers when landed beside them, drop them by parachute in the air.</li>
        <li>From wave 2, anti-air emplacements guard the enemy approach. Bullets barely scratch them: bomb them, airstrike them, or send troops.</li>
        <li>Garrisoned huts raise a tethered weather balloon. Fly an enemy chopper into it and the tether tears you up; shoot it to pop it. Your own held huts do the same to the enemy gunship.</li>
        <li>Soldiers who reach a house move in and hold it, firing from the windows. Enemy infantry can storm it one for one, and bombs can destroy an enemy-held house, leaving ruins. The next soldiers to arrive rebuild it; extra soldiers at a full house upgrade it to a bunker, then add an AA gun. Hostages at a house the enemy holds will not board your chopper. Every bunker musters a free soldier every 20 seconds (15 with an AA gun) for whoever holds it, so capture as many as you can, and take the enemy's away. Each bunker also pays its holder $10 every 10 seconds ($15 with an AA gun, more as the threat rises), and each bunker you hold when a wave is cleared adds 250 to the wave bonus. A bunker your troops hold is also a forward landing zone: land beside it to drop off hostages without flying home (repairs and rearming still happen only at base). Click or tap any house or bunker you hold to pay for the next level: bunker ($150), AA gun ($250), fortress ($400) and citadel ($600). Each level is tougher, musters troops faster, and pays more income. Enemy choppers raid your bunkers when you are not around, so defend them. Fortresses and citadels fire mortar rounds at enemy troops and tanks within range, and every bunker heals wounded friendly soldiers and tanks standing near it. Land beside a bunker you hold and your crew repairs it and slowly restocks your bombs. From wave 3, enemy supply trucks drive from their base to their front-line bunker; each one that arrives repairs that bunker and funds the enemy, and each one you destroy pays a 300-point bounty.</li>
        <li><kbd>P</kbd> pause &middot; <kbd>M</kbd> mute &middot; <kbd>R</kbd> restart</li>
        <li>Missiles (<kbd>V</kbd>) lock on to the nearest enemy aircraft, or to the nearest tank, gun or soldier when no aircraft is in range. Buy the Missiles upgrade (<kbd>M</kbd>, up to four levels) to carry two more each level. Later waves bring more anti-air sites, mostly homing-missile launchers from wave 8, and from wave 6 the enemy gunship fires homing missiles too, so flares matter.</li>
        <li>From wave 2, a supply crate parachutes into the middle of the battlefield about every 40 seconds. Fly into it to fully repair, rearm and collect cash, but if enemy troops reach it first they seize it for the enemy.</li>
        <li>With a mouse: hold the left button and the chopper flies toward the pointer, then hovers where you let go. Click to shoot (or to upgrade a bunker you hold), hold the right button for continuous fire, and scroll down or middle-click to bomb.</li>
        <li>On touch screens: drag to fly, tap to shoot, hold to bomb, and use the on-screen buttons.</li>
    </ul>
    </details>
</section>
@endsection
