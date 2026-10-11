<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>{{ config('app.name', 'NQ Chopper') }}</title>
    <link rel="stylesheet" href="{{ asset('css/game.css') }}">
    @if (config('services.google_analytics.id'))
        <!-- Google tag (gtag.js) -->
        <script async src="https://www.googletagmanager.com/gtag/js?id={{ config('services.google_analytics.id') }}"></script>
        <script>
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', @json(config('services.google_analytics.id')));
        </script>
        <!-- End Google Analytics -->
    @endif
</head>
<body>

</head>
<body>
    <div id="score">Score: 0 | Rescued: 0</div>
    <div id="controls">
        <span id="keyHelp"><kbd>Arrows</kbd>/<kbd>WASD</kbd> Fly &nbsp;·&nbsp; <kbd>Space</kbd> Shoot &nbsp;·&nbsp; <kbd>B</kbd> Bomb &nbsp;·&nbsp; <kbd>P</kbd> Pause &nbsp;·&nbsp; <kbd>M</kbd> Mute &nbsp;·&nbsp; <kbd>R</kbd> Restart</span>
        <span id="touchHelp" style="display:none">Drag on screen to fly &nbsp;·&nbsp; Tap to shoot &nbsp;·&nbsp; Hold to bomb</span>
        <button id="muteBtn">Sound: On</button><button id="fullscreenBtn">Fullscreen</button>
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
    <script src="{{ asset('js/game.js') }}"></script>
</body>
</html>
