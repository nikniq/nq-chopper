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
    <main class="page" id="main" tabindex="-1">
        @yield('content')
    </main>
    <footer class="footer">NQ Chopper &middot; <a href="{{ route('home') }}">Home</a> &middot; <a href="{{ route('game') }}">Play</a></footer>
</body>
</html>
