@extends('layouts.app')
@section('title', $boards[$board].' leaderboard · NQ Chopper')

@section('content')
<section class="hero compact"><h1>Leaderboard</h1><p class="tagline">Best run per pilot. Top 50.</p></section>

<nav class="tabs">
    @foreach ($boards as $key => $label)
        <a class="tab {{ $key === $board ? 'active' : '' }}" href="{{ route('leaderboard', ['board' => $key]) }}">{{ $label }}</a>
    @endforeach
</nav>

<section class="leaderboard">
    @if ($board === 'daily')
        <div class="daynav">
            <a class="btn btn-ghost" href="{{ route('leaderboard', ['board' => 'daily', 'day' => $prevDay]) }}">&larr; {{ $prevDay }}</a>
            <h2>Daily Challenge &middot; {{ $day }}</h2>
            @if ($nextDay)<a class="btn btn-ghost" href="{{ route('leaderboard', ['board' => 'daily', 'day' => $nextDay]) }}">{{ $nextDay }} &rarr;</a>@else<span class="muted">Today</span>@endif
        </div>
        @if ($day === \App\Models\Score::today())<p class="muted">Not flown yet? <a href="{{ route('game', ['daily' => 1]) }}">Take today's challenge.</a></p>@endif
    @else
        <h2>{{ $boards[$board] }}</h2>
    @endif

    @auth
        @if ($myRank)
            <p class="myrank">Your rank: <strong>#{{ $myRank['rank'] }}</strong> with {{ number_format($myRank['score']) }}</p>
        @else
            <p class="myrank muted">You have no run on this board yet.</p>
        @endif
    @endauth

    @if ($rows->isEmpty())
        <p class="muted">No scores on this board yet.</p>
    @else
        <table>
            <thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th><th>Rescued</th><th>When</th></tr></thead>
            <tbody>
            @foreach ($rows as $i => $row)
                <tr @class(['me' => auth()->check() && $row->user_id === auth()->id()])>
                    <td>{{ $i + 1 }}</td>
                    <td><a href="{{ route('profile', $row->user) }}">{{ $row->user->name }}</a></td>
                    <td>{{ number_format($row->score) }}</td>
                    <td>{{ $row->wave }}</td>
                    <td>{{ $row->rescued }}</td>
                    <td class="muted">{{ $row->created_at->diffForHumans() }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif
</section>
@endsection
