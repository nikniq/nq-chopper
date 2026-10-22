<?php

namespace Tests\Feature;

use Tests\TestCase;

class GamePageTest extends TestCase
{
    public function test_game_page_renders_canvas_and_assets(): void
    {
        $response = $this->get(route('game'));

        $response->assertOk()
            ->assertSee('<canvas id="gameCanvas"', false)
            ->assertSee('css/game.css')
            ->assertSee('js/game.js')
            ->assertSee('href="https://nikniq.com"', false);
    }

    public function test_analytics_tag_renders_configured_id_on_all_pages(): void
    {
        config(['services.google_analytics.id' => 'G-TEST1234']);

        $this->get(route('game'))->assertSee('googletagmanager.com/gtag/js?id=G-TEST1234', false)->assertSee("gtag('config', \"G-TEST1234\")", false);
        $this->get(route('home'))->assertSee('gtag/js?id=G-TEST1234', false);
        $this->get(route('login'))->assertSee('gtag/js?id=G-TEST1234', false);
    }

    public function test_analytics_tag_is_omitted_without_an_id(): void
    {
        config(['services.google_analytics.id' => null]);

        $this->get(route('game'))->assertDontSee('googletagmanager');
    }
}
