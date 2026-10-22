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
    <div class="feature"><h3>Survive</h3><p>Every third wave brings a gunship. Destroyed enemies drop hull, bombs and credits.</p></div>
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
        <li><kbd>Arrows</kbd> / <kbd>WASD</kbd> fly &middot; <kbd>Space</kbd> shoot &middot; <kbd>B</kbd> bomb &middot; hold <kbd>Shift</kbd> for the jet booster (meter recharges after a pause)</li>
        <li>Every wave raises the threat level: tougher armour, harder-hitting shells, a richer enemy war chest and a gunship every third wave.</li>
        <li><kbd>1</kbd> buy a soldier ($50) &middot; <kbd>2</kbd> buy a tank ($200) &middot; <kbd>3</kbd> upgrade guns &middot; <kbd>4</kbd> upgrade armour</li>
        <li>Chain kills quickly for a combo multiplier of up to 3&times; points.</li>
        <li><kbd>5</kbd> call an airstrike ($250) &middot; <kbd>6</kbd> hold or release your troops at your position &middot; <kbd>7</kbd> load soldiers when landed beside them, drop them by parachute in the air.</li>
        <li>From wave 2, anti-air emplacements guard the enemy approach. Bullets barely scratch them: bomb them, airstrike them, or send troops.</li>
        <li>Garrisoned huts raise a tethered weather balloon. Fly an enemy chopper into it and the tether tears you up; shoot it to pop it. Your own held huts do the same to the enemy gunship.</li>
        <li>Soldiers who reach a hut move in and hold it. Garrisoned soldiers fire from the windows and cannot be bombed or shot; only enemy infantry storming the hut can remove them, one for one. Hostages at a hut the enemy holds will not board your chopper.</li>
        <li><kbd>P</kbd> pause &middot; <kbd>M</kbd> mute &middot; <kbd>R</kbd> restart</li>
        <li>On touch screens: drag to fly, tap to shoot, hold to bomb, and use the on-screen buttons.</li>
    </ul>
</section>
@endsection
