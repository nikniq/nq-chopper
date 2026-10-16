@extends('layouts.app')
@section('title', 'Multiplayer · NQ Chopper')

@section('content')
<section class="hero compact">
    <h1>Multiplayer</h1>
    <p class="tagline">Play online with a friend: duel 1v1, or team up in co-op against the AI waves.</p>
</section>

<div class="two-col">
    <section class="card">
        <h2>Host a match</h2>
        <p class="muted">You get a six-letter code to send to your opponent. The game starts when they join.</p>
        @if ($open)
            <p>Your open lobby: <strong class="code">{{ $open->code }}</strong></p>
            <p class="muted">Invite link: <a href="{{ route('matches.invite', ['code' => $open->code]) }}">{{ route('matches.invite', ['code' => $open->code]) }}</a></p>
            <a class="btn btn-big" href="{{ route('game', ['code' => $open->code]) }}">Return to lobby</a>
        @endif
        <form method="POST" action="{{ route('matches.store') }}">
            @csrf
            <fieldset class="modes">
                <legend class="muted">Mode</legend>
                <label class="mode"><input type="radio" name="mode" value="versus" checked> <strong>Versus 1v1</strong><span class="muted">Two bases, armies marching at each other. First base down loses.</span></label>
                <label class="mode"><input type="radio" name="mode" value="coop"> <strong>Co-op vs AI</strong><span class="muted">One base, shared lives, survive the waves together.</span></label>
            </fieldset>
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
        <li><strong>Co-op:</strong> you share one base and a pool of four lives. Each wave cleared adds a life. Allied fire never hurts your partner, but bombs still do.</li>
        <li>Your troops march toward the enemy base, theirs march toward yours. Bases have 1500 hull. First base down loses.</li>
        <li>Hostages keep appearing in the middle of the map. Each one you fly home is worth $40 and 100 points.</li>
        <li>Soldiers garrison the huts they reach and hold them against tanks and bombs. Only enemy soldiers entering the hut can clear them, one defender per attacker. Hostages at a hut your opponent holds will not board you.</li>
        <li>If you are shot down you redeploy at your base after a few seconds, but anyone aboard is lost.</li>
        <li>A direct peer-to-peer connection is always preferred. If it is not up within a few seconds the match starts over a server relay, and upgrades to the direct link automatically as soon as it connects.</li>
    </ul>
</section>

<section class="leaderboard">
    <h2>Your recent matches</h2>
    @if ($recent->isEmpty())
        <p class="muted">No finished matches yet.</p>
    @else
        <table>
            <thead><tr><th>When</th><th>Mode</th><th>Host</th><th>Guest</th><th>Score</th><th>Result</th></tr></thead>
            <tbody>
            @foreach ($recent as $m)
                <tr>
                    <td>{{ $m->finished_at?->diffForHumans() }}</td>
                    <td>{{ $m->mode === 'coop' ? 'Co-op' : 'Versus' }}</td>
                    <td>{{ $m->host->name }}</td>
                    <td>{{ $m->guest?->name ?? '—' }}</td>
                    <td>{{ $m->host_score }} – {{ $m->guest_score }}</td>
                    <td>
                        @if ($m->mode === 'coop') Wave {{ $m->wave ?? '?' }}
                        @elseif ($m->winner_user_id === auth()->id()) <span class="win">Won</span>
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
