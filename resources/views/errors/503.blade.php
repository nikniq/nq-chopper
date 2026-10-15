@extends('layouts.app')
@section('title', '503 · NQ Chopper')

@section('content')
<section class="hero">
    <h1 class="err-code">503</h1>
    <p class="tagline">Base under maintenance</p>
    <p class="blurb">We are deploying an update. Back in a minute.</p>
    <div class="cta"><a href="{{ route('home') }}" class="btn btn-big">Home</a> <a href="{{ route('game') }}" class="btn btn-big btn-ghost">Play</a></div>
</section>
@endsection
