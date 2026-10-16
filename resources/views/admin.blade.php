@extends('layouts.app')
@section('title', 'Operations · NQ Chopper')

@section('content')
<section class="hero compact"><h1>Operations</h1><p class="tagline">Who is flying, and how the servers are doing.</p></section>

<section class="stats">
    <div class="stat"><span class="num">{{ $users['total'] }}</span><span class="lbl">Pilots ({{ $users['week'] }} this week)</span></div>
    <div class="stat"><span class="num">{{ $runs['total'] }}</span><span class="lbl">Runs recorded</span></div>
    <div class="stat"><span class="num">{{ $runs['today'] }}</span><span class="lbl">Runs today</span></div>
    <div class="stat"><span class="num">{{ $runs['daily'] }}</span><span class="lbl">Pilots in today's daily</span></div>
    <div class="stat"><span class="num">{{ $matches['active'] }}</span><span class="lbl">Matches live ({{ $matches['waiting'] }} waiting)</span></div>
    <div class="stat"><span class="num">{{ $matches['finished'] }}</span><span class="lbl">Matches finished</span></div>
</section>

<div class="two-col">
    <section class="leaderboard">
        <h2>Newest pilots</h2>
        <table><thead><tr><th>Pilot</th><th>Joined</th></tr></thead><tbody>
        @foreach ($newest as $u)<tr><td><a href="{{ route('profile', $u) }}">{{ $u->name }}</a></td><td>{{ $u->created_at->diffForHumans() }}</td></tr>@endforeach
        </tbody></table>
    </section>
    <section class="leaderboard">
        <h2>Latest runs</h2>
        <table><thead><tr><th>Pilot</th><th>Mode</th><th>Score</th><th>When</th></tr></thead><tbody>
        @foreach ($recentRuns as $r)<tr><td>{{ $r->user?->name }}</td><td>{{ $r->mode }}</td><td>{{ number_format($r->score) }}</td><td>{{ $r->created_at->diffForHumans() }}</td></tr>@endforeach
        </tbody></table>
    </section>
</div>
<p class="muted">Maintenance: <code>php artisan matches:prune</code> runs hourly and <code>php artisan db:backup</code> nightly via the scheduler. Health: <a href="{{ route('health') }}">/health</a>.</p>
@endsection
