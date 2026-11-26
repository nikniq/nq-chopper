    <footer class="footer">
        <div class="footer-inner">
            <div class="footer-brand">
                <a class="brand" href="{{ route('home') }}"><img src="{{ asset('icon.svg') }}" alt="" width="24" height="24"> NQ CHOPPER</a>
                <p>Free helicopter rescue and strategy game. Part of the <a href="https://nikniq.com">nikniq.com</a> games family.</p>
                <a class="back-nikniq" href="https://nikniq.com">&larr; Back to nikniq.com</a>
            </div>
            <nav class="footer-links" aria-label="Footer">
                <a href="{{ route('game') }}">Play</a>
                <a href="{{ route('game', ['daily' => 1]) }}">Daily Challenge</a>
                <a href="{{ route('leaderboard') }}">Leaderboard</a>
                <a href="{{ route('home') }}#manual">How to play</a>
                <a href="https://nikniq.com">More games on nikniq.com</a>
                @guest<a href="{{ route('login') }}">Log in</a><a href="{{ route('register') }}">Sign up</a>@endguest
            </nav>
        </div>
        <p class="copy">&copy; {{ date('Y') }} NQ Chopper</p>
    </footer>
