@extends('layouts.app')
@section('title', 'Multiplayer · NQ Chopper')

@section('content')
<section class="hero compact">
    <h1>Multiplayer</h1>
    <p class="tagline">1v1 online. Rescue hostages for credits, raise an army, and destroy the other pilot's base.</p>
</section>

<div class="two-col">
    <section class="card">
        <h2>Host a match</h2>
        <p class="muted">You get a six-letter code to send to your opponent. The game starts when they join.</p>
        @if ($open)
            <p>Your open lobby: <strong class="code">{{ $open->code }}</strong></p>
            <a class="btn btn-big" href="{{ route('game', ['code' => $open->code]) }}">Return to lobby</a>
        @endif
        <form method="POST" action="{{ route('matches.store') }}">
            @csrf
            <button type="submit" class="btn btn-big {{ $open ? 'btn-ghost' : '' }}">{{ $open ? 'Create a new code' : 'Create match' }}</button>
        </form>
    </section>

    <section class="card">
        <h2>Join a match</h2>
        <form method="POST" action="{{ route('matches.join') }}">
            @csrf
            <label>Match code
                <input type="text" name="code" value="{{ old('code') }}" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDEF" required class="code-input">
            </label>
            @error('code')<p class="error">{{ $message }}</p>@enderror
            <button type="submit" class="btn btn-big">Join</button>
        </form>
    </section>
</div>

<section class="leaderboard">
    <h2>How it works</h2>
    <ul class="plain">
        <li>Both browsers run the same simulation in lockstep and talk directly to each other over WebRTC. The server only pairs you up.</li>
        <li>Your troops march toward the enemy base, theirs march toward yours. Bases have 1500 hull. First base down loses.</li>
        <li>Hostages keep appearing in the middle of the map. Each one you fly home is worth $40 and 100 points.</li>
        <li>Soldiers garrison the huts they reach and hold them against tanks and bombs. Only enemy soldiers entering the hut can clear them, one defender per attacker. Hostages at a hut your opponent holds will not board you.</li>
        <li>If you are shot down you redeploy at your base after a few seconds, but anyone aboard is lost.</li>
        <li>Strict corporate networks can block direct connections. If "Connecting" never finishes, try another network.</li>
    </ul>
</section>

<section class="leaderboard">
    <h2>Your recent matches</h2>
    @if ($recent->isEmpty())
        <p class="muted">No finished matches yet.</p>
    @else
        <table>
            <thead><tr><th>When</th><th>Host</th><th>Guest</th><th>Score</th><th>Result</th></tr></thead>
            <tbody>
            @foreach ($recent as $m)
                <tr>
                    <td>{{ $m->finished_at?->diffForHumans() }}</td>
                    <td>{{ $m->host->name }}</td>
                    <td>{{ $m->guest?->name ?? '—' }}</td>
                    <td>{{ $m->host_score }} – {{ $m->guest_score }}</td>
                    <td>
                        @if ($m->winner_user_id === auth()->id()) <span class="win">Won</span>
                        @elseif ($m->winner_user_id) <span class="loss">Lost</span>
                        @else Draw @endif
                        <span class="muted">({{ strtolower($m->reason) }})</span>
                    </td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif
</section>
@endsection
