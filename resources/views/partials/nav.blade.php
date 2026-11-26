<header class="topbar">
    <nav class="nav" aria-label="Main">
        <a class="brand" href="{{ route('home') }}" aria-label="NQ Chopper home">
            <img src="{{ asset('icon.svg') }}" alt="" width="32" height="32">
            <span>NQ CHOPPER</span>
        </a>
        <input type="checkbox" id="navToggle" class="nav-toggle" aria-hidden="true" tabindex="-1">
        <label for="navToggle" class="nav-burger" aria-label="Menu"><span></span><span></span><span></span></label>
        <div class="nav-menu">
            <div class="nav-links">
                <a href="{{ route('game', ['daily' => 1]) }}" @class(['active' => request()->boolean('daily')])>Daily Challenge</a>
                <a href="{{ route('leaderboard') }}" @class(['active' => request()->routeIs('leaderboard')])>Leaderboard</a>
                <a href="{{ auth()->check() ? route('multiplayer') : route('login') }}" @class(['active' => request()->routeIs('multiplayer')])>Multiplayer</a>
                <a href="{{ route('home') }}#manual">How to play</a>
                <a class="parent-site" href="https://nikniq.com" title="Back to nikniq.com: more games">&larr; nikniq.com</a>
            </div>
            <div class="nav-actions">
                @auth
                    <details class="account">
                        <summary>
                            @if (auth()->user()->avatar)<img src="{{ auth()->user()->avatar }}" alt="" width="26" height="26" referrerpolicy="no-referrer">@else<span class="avatar">{{ mb_strtoupper(mb_substr(auth()->user()->name, 0, 1)) }}</span>@endif
                            <span class="pilot">{{ auth()->user()->name }}</span>
                        </summary>
                        <div class="account-menu">
                            <a href="{{ route('profile', auth()->user()) }}">My pilot profile</a>
                            <a href="{{ route('settings') }}">Settings</a>
                            @if (\App\Http\Controllers\AdminController::isAdmin(auth()->user()))<a href="{{ route('admin') }}">Ops</a>@endif
                            <form method="POST" action="{{ route('logout') }}">
                                @csrf
                                <button type="submit" class="link">Log out</button>
                            </form>
                        </div>
                    </details>
                @else
                    <a href="{{ route('login') }}" class="nav-login">Log in</a>
                    <a href="{{ route('register') }}" class="nav-login">Sign up</a>
                @endauth
                @unless (request()->routeIs('game') && !request()->boolean('daily'))<a href="{{ route('game') }}" class="btn btn-play">Play free</a>@endunless
            </div>
        </div>
    </nav>
</header>
