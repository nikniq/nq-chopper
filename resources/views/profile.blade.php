@extends('layouts.app')
@section('title', $pilot->name.' · NQ Chopper')

@section('content')
<section class="hero compact">
    <h1>{{ $pilot->name }}</h1>
    <p class="tagline">Pilot since {{ $pilot->created_at->format('j M Y') }}</p>
</section>

<section class="stats">
    <div class="stat"><span class="num">{{ number_format($stats['best']) }}</span><span class="lbl">Best score</span></div>
    <div class="stat"><span class="num">{{ $stats['topWave'] }}</span><span class="lbl">Highest wave</span></div>
    <div class="stat"><span class="num">{{ number_format($stats['rescued']) }}</span><span class="lbl">Hostages rescued</span></div>
    <div class="stat"><span class="num">{{ $stats['games'] }}</span><span class="lbl">Solo runs</span></div>
    <div class="stat"><span class="num">{{ number_format($stats['dailyBest']) }}</span><span class="lbl">Today's daily</span></div>
    <div class="stat"><span class="num">{{ $stats['wins'] }} / {{ $stats['matches'] }}</span><span class="lbl">Duels won</span></div>
</section>

<section class="leaderboard">
    <h2>Recent runs</h2>
    @if ($recent->isEmpty())
        <p class="muted">No runs recorded yet.</p>
    @else
        <table>
            <thead><tr><th>When</th><th>Mode</th><th>Score</th><th>Wave</th><th>Rescued</th></tr></thead>
            <tbody>
            @foreach ($recent as $r)
                <tr><td>{{ $r->created_at->diffForHumans() }}</td><td>{{ $r->mode === 'daily' ? 'Daily '.$r->day?->format('M j') : 'Solo' }}</td><td>{{ number_format($r->score) }}</td><td>{{ $r->wave }}</td><td>{{ $r->rescued }}</td></tr>
            @endforeach
            </tbody>
        </table>
    @endif
</section>

<section class="leaderboard">
    <h2>Recent duels</h2>
    @if ($matches->isEmpty())
        <p class="muted">No online matches finished yet.</p>
    @else
        <table>
            <thead><tr><th>When</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead>
            <tbody>
            @foreach ($matches as $m)
                @php $opp = $m->host_user_id === $pilot->id ? $m->guest : $m->host; $mine = $m->host_user_id === $pilot->id ? $m->host_score : $m->guest_score; $theirs = $m->host_user_id === $pilot->id ? $m->guest_score : $m->host_score; @endphp
                <tr>
                    <td>{{ $m->finished_at?->diffForHumans() }}</td>
                    <td>@if ($opp)<a href="{{ route('profile', $opp) }}">{{ $opp->name }}</a>@else — @endif</td>
                    <td>{{ $mine }} – {{ $theirs }}</td>
                    <td>@if ($m->winner_user_id === $pilot->id)<span class="win">Won</span>@elseif ($m->winner_user_id)<span class="loss">Lost</span>@else Draw @endif</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif
</section>
@endsection
