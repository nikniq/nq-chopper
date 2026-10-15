@extends('layouts.app')
@section('title', '500 · NQ Chopper')

@section('content')
<section class="hero">
    <h1 class="err-code">500</h1>
    <p class="tagline">Chopper down</p>
    <p class="blurb">Something went wrong on our side. Please try again in a moment.</p>
    <div class="cta"><a href="{{ route('home') }}" class="btn btn-big">Home</a> <a href="{{ route('game') }}" class="btn btn-big btn-ghost">Play</a></div>
</section>
@endsection
