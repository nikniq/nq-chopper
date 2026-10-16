<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>{{ config('app.name', 'NQ Chopper') }}</title>
    <link rel="stylesheet" href="{{ asset('css/game.css') }}?v={{ filemtime(public_path('css/game.css')) }}">
    @include('partials.head-meta')
    <meta name="csrf-token" content="{{ csrf_token() }}">
    @include('partials.analytics')
</head>
<body>
    <div id="topbar">
        <a href="{{ route('home') }}">&larr; Home</a>
        @if (!empty($match))
            <span>Online match <strong>{{ $match['code'] }}</strong> &middot; <a href="{{ route('multiplayer') }}">Lobby</a>
                @if ($match['role'] === 'host' && empty($match['opponent']))
                    &middot; <button type="button" class="linkbtn" id="copyInvite" data-link="{{ route('matches.invite', ['code' => $match['code']]) }}">Copy invite link</button>
                @endif
            </span>
        @elseif (!empty($daily))
            <span>Daily Challenge <strong>{{ $daily['day'] }}</strong> &middot; <a href="{{ route('game') }}">Free play</a></span>
        @endif
        @auth
            <span>Pilot <strong>{{ auth()->user()->name }}</strong> &middot; scores are saved</span>
            <form method="POST" action="{{ route('logout') }}" style="display:inline">@csrf<button type="submit" class="linkbtn">Log out</button></form>
        @else
            <span><a href="{{ route('login') }}">Log in</a> or <a href="{{ route('register') }}">register</a> to save your scores</span>
        @endauth
    </div>
    <div id="score">Score: 0 | Rescued: 0</div>
    <div id="controls">
        <span id="keyHelp"><kbd>Arrows</kbd>/<kbd>WASD</kbd> Fly &nbsp;·&nbsp; <kbd>Space</kbd> Shoot &nbsp;·&nbsp; <kbd>B</kbd> Bomb &nbsp;·&nbsp; <kbd>1</kbd>/<kbd>2</kbd> Buy troops &nbsp;·&nbsp; <kbd>P</kbd> Pause &nbsp;·&nbsp; <kbd>M</kbd> Mute &nbsp;·&nbsp; <kbd>R</kbd> Restart</span>
        <span id="touchHelp" style="display:none">Drag on screen to fly &nbsp;·&nbsp; Tap to shoot &nbsp;·&nbsp; Hold to bomb</span>
        <button id="muteBtn">Sound: On</button><button id="fullscreenBtn">Fullscreen</button>
    </div>
    <div id="shop">
        <span id="shopLabel">Credits <strong id="credits">$0</strong></span>
        <button id="buySoldier" class="shop-btn" disabled>Soldier <span class="price">$50</span></button>
        <button id="buyTank" class="shop-btn" disabled>Tank <span class="price">$200</span></button>
        <button id="buyGun" class="shop-btn upgrade" disabled>Guns<span class="lvl"></span> <span class="price">$150</span></button>
        <button id="buyArmor" class="shop-btn upgrade" disabled>Armor<span class="lvl"></span> <span class="price">$150</span></button>
        <span id="shopHint">Troops deploy from BASE and march on the enemy base &middot; Upgrades last the whole game</span>
        <button id="shareBtn" class="shop-btn share" style="display:none" data-url="{{ url('/') }}">Share score</button>
    </div>
    <div id="gameWrapper">
        <div id="canvasWrapper">
            <canvas id="gameCanvas" width="640" height="400"></canvas>
        </div>
    </div>
    <div id="touchControls" aria-hidden="false">
        <div class="touch-group" id="dirGroup">
            <button class="touch-btn" id="btnLeft">◀</button>
            <button class="touch-btn" id="btnUp">▲</button>
            <button class="touch-btn" id="btnDown">▼</button>
            <button class="touch-btn" id="btnRight">▶</button>
        </div>
        <div class="touch-group" id="actionGroup">
            <button class="touch-btn" id="btnShoot">Shoot</button>
            <button class="touch-btn" id="btnBomb">Bomb</button>
        </div>
    </div>
    <script>window.NQ_CONFIG = { scoreUrl: @json(auth()->check() ? route('scores.store') : null), csrf: @json(csrf_token()), match: @json($match ?? null), daily: @json($daily ?? null), pingUrl: @json(auth()->check() ? route('ping') : null) };</script>
    <script>
        (function () {
            var b = document.getElementById('copyInvite');
            if (!b) return;
            b.addEventListener('click', function () {
                var link = b.getAttribute('data-link');
                var done = function () { b.textContent = 'Invite link copied!'; setTimeout(function () { b.textContent = 'Copy invite link'; }, 2500); };
                if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this invite link', link); });
                else window.prompt('Copy this invite link', link);
            });
        })();
    </script>
    <script src="{{ asset('js/sim.js') }}?v={{ filemtime(public_path('js/sim.js')) }}"></script>
    <script src="{{ asset('js/net.js') }}?v={{ filemtime(public_path('js/net.js')) }}"></script>
    <script src="{{ asset('js/game.js') }}?v={{ filemtime(public_path('js/game.js')) }}"></script>
</body>
</html>
