<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccessibilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_pages_expose_landmarks_labels_and_live_region(): void
    {
        $this->get('/')->assertOk()
            ->assertSee('class="skip-link"', false)->assertSee('id="main"', false)->assertSee('aria-label="Main"', false)
            ->assertSee('href="https://nikniq.com"', false);

        $this->get('/play')->assertOk()
            ->assertSee('role="img"', false)
            ->assertSee('aria-live="polite"', false)
            ->assertSee('aria-label="Fly left"', false)
            ->assertSee('aria-pressed="false"', false)
            ->assertSee('Skip to game');
    }
}
