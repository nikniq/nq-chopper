<nav class="nav">
    <a class="brand" href="{{ route('home') }}">NQ CHOPPER</a>
    <div class="nav-links">
        <a href="{{ route('game') }}" class="btn btn-play">Play</a>
        @auth
            <a href="{{ route('multiplayer') }}">Multiplayer</a>
            <span class="pilot">Pilot <strong>{{ auth()->user()->name }}</strong></span>
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
