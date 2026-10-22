<nav class="nav" aria-label="Main">
    <a class="brand" href="{{ route('home') }}">NQ CHOPPER</a>
    <a class="parent-site" href="https://nikniq.com" title="Back to nikniq.com">&larr; nikniq.com</a>
    <div class="nav-links">
        <a href="{{ route('leaderboard') }}">Leaderboard</a>
        <a href="{{ route('game') }}" class="btn btn-play">Play</a>
        @auth
            <a href="{{ route('multiplayer') }}">Multiplayer</a>
            <a href="{{ route('profile', auth()->user()) }}" class="pilot">Pilot <strong>{{ auth()->user()->name }}</strong></a>
            <a href="{{ route('settings') }}">Settings</a>
            @if (\App\Http\Controllers\AdminController::isAdmin(auth()->user()))<a href="{{ route('admin') }}">Ops</a>@endif
            <form method="POST" action="{{ route('logout') }}" class="inline">
                @csrf
                <button type="submit" class="link">Log out</button>
            </form>
        @else
            <a href="{{ route('login') }}">Log in</a>
            <a href="{{ route('register') }}" class="btn">Register</a>
        @endauth
    </div>
</nav>
