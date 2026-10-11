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
            ->assertSee('js/game.js');
    }

    public function test_analytics_tag_is_omitted_without_an_id(): void
    {
        config(['services.google_analytics.id' => null]);

        $this->get(route('game'))->assertDontSee('googletagmanager');
    }
}
