<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', config('app.name', 'NQ Chopper'))</title>
    <link rel="stylesheet" href="{{ asset('css/site.css') }}?v={{ filemtime(public_path('css/site.css')) }}">
    @include('partials.head-meta')
    @include('partials.analytics')
</head>
<body class="site">
    <a class="skip-link" href="#main">Skip to content</a>
    @include('partials.nav')
    <main @class(['page', 'wide' => View::hasSection('wide')]) id="main" tabindex="-1">
        @yield('content')
    </main>
    <footer class="footer">
        <div class="footer-inner">
            <div class="footer-brand">
                <a class="brand" href="{{ route('home') }}"><img src="{{ asset('icon.svg') }}" alt="" width="24" height="24"> NQ CHOPPER</a>
                <p>Free helicopter rescue and strategy game. Part of the <a href="https://nikniq.com">nikniq.com</a> games family.</p>
            </div>
            <nav class="footer-links" aria-label="Footer">
                <a href="{{ route('game') }}">Play</a>
                <a href="{{ route('game', ['daily' => 1]) }}">Daily Challenge</a>
                <a href="{{ route('leaderboard') }}">Leaderboard</a>
                <a href="{{ route('home') }}#manual">How to play</a>
                <a href="https://nikniq.com">More games</a>
            </nav>
        </div>
        <p class="copy">&copy; {{ date('Y') }} NQ Chopper</p>
    </footer>
</body>
</html>
