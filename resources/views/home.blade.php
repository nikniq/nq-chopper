@extends('layouts.app')

@section('content')
<section class="hero">
    <h1>NQ CHOPPER</h1>
    <p class="tagline">Fly in, land hot, and bring the hostages home.</p>
    <p class="blurb">
        A side-scrolling rescue shooter. Dodge tanks and an enemy gunship, pick up hostages four at a time,
        and spend the credits you earn on soldiers and tanks that march on the enemy base.
    </p>
    <div class="cta">
        <a href="{{ route('game') }}" class="btn btn-big">Play solo</a>
        <a href="{{ route('game', ['daily' => 1]) }}" class="btn btn-big btn-daily">Daily Challenge</a>
        @guest
            <a href="{{ route('login') }}" class="btn btn-big btn-ghost" title="Log in to play online">Multiplayer</a>
            <span class="muted" style="width:100%">Register to save your scores and play 1v1 online.</span>
        @else
            <a href="{{ route('multiplayer') }}" class="btn btn-big btn-ghost">Multiplayer 1v1</a>
            <span class="muted" style="width:100%">Your best: <strong>{{ number_format($personalBest) }}</strong></span>
        @endguest
    </div>
</section>

<section class="features">
    <div class="feature"><h3>Rescue</h3><p>Land near the huts and hostages run aboard. Four seats, then back to base.</p></div>
    <div class="feature"><h3>Fight</h3><p>Guns for the enemy chopper, bombs for the tanks. Base repairs and rearms you.</p></div>
    <div class="feature"><h3>Command</h3><p>Buy soldiers and tanks with credits. They march across the field and destroy the enemy base.</p></div>
    <div class="feature"><h3>Survive</h3><p>Every third wave brings a gunship. Destroyed enemies drop hull, bombs and credits. You fly with two spare choppers and earn another for each gunship wave cleared.</p></div>
    <div class="feature"><h3>Duel</h3><p>Challenge a friend to 1v1 online. Same map, two bases, armies marching at each other.</p></div>
</section>

<section class="leaderboard">
    <h2>Daily Challenge &middot; {{ $today }} <a class="more" href="{{ route('leaderboard', ['board' => 'daily']) }}">Archive &rarr;</a></h2>
    <p class="muted">Everyone gets the same world today. One board per day, resets at midnight UTC.
        @auth @if ($dailyBest) Your best today: <strong>{{ number_format($dailyBest) }}</strong>. @endif @endauth</p>
    @if ($dailyLeaders->isEmpty())
        <p class="muted">Nobody has flown today's challenge yet. <a href="{{ route('game', ['daily' => 1]) }}">Be first.</a></p>
    @else
        <table>
            <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th><th>Rescued</th></tr></thead>
            <tbody>
            @foreach ($dailyLeaders as $i => $row)
                <tr @class(['me' => auth()->check() && $row['user_id'] === auth()->id()])>
                    <td>{{ $i + 1 }}</td><td><a href="{{ route('profile', $row['user_id']) }}">{{ $row['name'] }}</a></td><td>{{ number_format($row['score']) }}</td><td>{{ $row['wave'] }}</td><td>{{ $row['rescued'] }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif
</section>

<section class="leaderboard">
    <h2>All-time leaderboard <a class="more" href="{{ route('leaderboard') }}">Full boards: monthly, weekly, daily archive &rarr;</a></h2>
    @if ($leaders->isEmpty())
        <p class="muted">No scores yet. Be the first pilot on the board.</p>
    @else
        <table>
            <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th><th>Rescued</th></tr></thead>
            <tbody>
            @foreach ($leaders as $i => $row)
                <tr @class(['me' => auth()->check() && $row['user_id'] === auth()->id()])>
                    <td>{{ $i + 1 }}</td>
                    <td><a href="{{ route('profile', $row['user_id']) }}">{{ $row['name'] }}</a></td>
                    <td>{{ number_format($row['score']) }}</td>
                    <td>{{ $row['wave'] }}</td>
                    <td>{{ $row['rescued'] }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif
    @guest
        <p class="muted"><a href="{{ route('login') }}">Log in</a> or <a href="{{ route('register') }}">register</a> and your games are saved here automatically.</p>
    @endguest
</section>

<section class="controls-help">
    <h2>Controls</h2>
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
</section>
@endsection
