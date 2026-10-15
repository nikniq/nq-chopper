@extends('layouts.app')
@section('title', '404 · NQ Chopper')

@section('content')
<section class="hero">
    <h1 class="err-code">404</h1>
    <p class="tagline">Lost over enemy territory</p>
    <p class="blurb">That page does not exist. Check the link, or fly home.</p>
    <div class="cta"><a href="{{ route('home') }}" class="btn btn-big">Home</a> <a href="{{ route('game') }}" class="btn btn-big btn-ghost">Play</a></div>
</section>
@endsection
