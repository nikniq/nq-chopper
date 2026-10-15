@extends('layouts.app')
@section('title', '419 · NQ Chopper')

@section('content')
<section class="hero">
    <h1 class="err-code">419</h1>
    <p class="tagline">Session expired</p>
    <p class="blurb">Your session timed out. Go back and try again.</p>
    <div class="cta"><a href="{{ route('home') }}" class="btn btn-big">Home</a> <a href="{{ route('game') }}" class="btn btn-big btn-ghost">Play</a></div>
</section>
@endsection
