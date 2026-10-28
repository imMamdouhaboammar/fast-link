<?php
/**
 * Plugin Name: FastLink Accelerator for WordPress & WooCommerce
 * Description: Framework-independent interaction acceleration and conversion-safe advertising measurement.
 * Version: 1.0.0
 * Author: FastLink Engineering
 * License: MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

class FastLink_Plugin {
    public function __construct() {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_assets']);
        add_action('rest_api_init', [$this, 'register_collector_endpoint']);
    }

    public function enqueue_assets() {
        // Enqueue FastLink browser runtime
        wp_enqueue_script(
            'fastlink-runtime',
            plugins_url('assets/fastlink.min.js', __FILE__),
            [],
            '1.0.0',
            true
        );

        // Pass server configuration to client
        $config = [
            'mode' => 'safe',
            'navigation' => [
                'prefetch' => 'same-origin',
                'preserveNativeClicks' => true,
                'exclude' => [
                    wp_parse_url(admin_url(), PHP_URL_PATH) . '*',
                    wp_parse_url(wp_login_url(), PHP_URL_PATH) . '*',
                    '/wp-json/*',
                    '/?wc-ajax=*',
                    '/checkout/order-pay/*',
                    '/logout'
                ]
            ],
            'signals' => [
                'collector' => esc_url_raw(rest_url('fastlink/v1/events')),
                'providers' => [
                    'meta' => true,
                    'tiktok' => true,
                    'gtm' => true
                ]
            ]
        ];

        wp_add_inline_script(
            'fastlink-runtime',
            'window.__FAST_LINK_CONFIG__ = ' . wp_json_encode($config) . ';',
            'before'
        );
    }

    public function register_collector_endpoint() {
        register_rest_route('fastlink/v1', '/events', [
            'methods' => 'POST',
            'callback' => [$this, 'handle_event_ingestion'],
            'permission_callback' => '__return_true'
        ]);
    }

    public function handle_event_ingestion(WP_REST_Request $request) {
        $params = $request->get_json_params();

        if (empty($params['event_id']) || empty($params['event_name'])) {
            return new WP_Error('invalid_payload', 'Missing event_id or event_name', ['status' => 400]);
        }

        $event_id = sanitize_text_field($params['event_id']);
        $event_name = sanitize_text_field($params['event_name']);

        // Idempotency check using WordPress transient cache
        $transient_key = 'fl_evt_' . md5($event_id);
        if (get_transient($transient_key)) {
            return rest_ensure_response([
                'status' => 'deduplicated',
                'event_id' => $event_id
            ]);
        }

        // Store event ID for 10 minutes to prevent duplicate attribution
        set_transient($transient_key, true, 600);

        // Optional: hook for downstream processing / server CAPI forwarding
        do_action('fastlink_event_received', $params);

        return rest_ensure_response([
            'status' => 'received',
            'event_id' => $event_id
        ]);
    }
}

new FastLink_Plugin();
