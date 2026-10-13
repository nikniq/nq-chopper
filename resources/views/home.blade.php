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
        <a href="{{ route('game') }}" class="btn btn-big">Play now</a>
        @guest
            <a href="{{ route('register') }}" class="btn btn-ghost">Register to save your scores</a>
        @else
            <span class="muted">Your best: <strong>{{ number_format($personalBest) }}</strong></span>
        @endguest
    </div>
</section>

<section class="features">
    <div class="feature"><h3>Rescue</h3><p>Land near the huts and hostages run aboard. Four seats, then back to base.</p></div>
    <div class="feature"><h3>Fight</h3><p>Guns for the enemy chopper, bombs for the tanks. Base repairs and rearms you.</p></div>
    <div class="feature"><h3>Command</h3><p>Buy soldiers and tanks with credits. They march across the field and destroy the enemy base.</p></div>
</section>

<section class="leaderboard">
    <h2>Leaderboard</h2>
    @if ($leaders->isEmpty())
        <p class="muted">No scores yet. Be the first pilot on the board.</p>
    @else
        <table>
            <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th><th>Rescued</th></tr></thead>
            <tbody>
            @foreach ($leaders as $i => $row)
                <tr @class(['me' => auth()->check() && $row->user_id === auth()->id()])>
                    <td>{{ $i + 1 }}</td>
                    <td>{{ $row->user->name }}</td>
                    <td>{{ number_format($row->score) }}</td>
                    <td>{{ $row->wave }}</td>
                    <td>{{ $row->rescued }}</td>
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
        <li><kbd>Arrows</kbd> / <kbd>WASD</kbd> fly &middot; <kbd>Space</kbd> shoot &middot; <kbd>B</kbd> bomb</li>
        <li><kbd>1</kbd> buy a soldier ($50) &middot; <kbd>2</kbd> buy a tank ($200)</li>
        <li><kbd>P</kbd> pause &middot; <kbd>M</kbd> mute &middot; <kbd>R</kbd> restart</li>
        <li>On touch screens: drag to fly, tap to shoot, hold to bomb, and use the on-screen buttons.</li>
    </ul>
</section>
@endsection
