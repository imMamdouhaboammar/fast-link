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
        // Functions cannot be encoded in JSON; attach the evaluator before auto-init.
        wp_add_inline_script('fastlink-runtime', <<<'JS'
window.__FAST_LINK_CONFIG__.signals.consent = function () {
  if (typeof window.wp_has_consent === 'function') return window.wp_has_consent('marketing') === true;
  if (window.Cookiebot && window.Cookiebot.consent) return window.Cookiebot.consent.marketing === true;
  if (typeof window.cmplz_has_consent === 'function') return window.cmplz_has_consent('marketing') === true;
  return false;
};
JS, 'before');
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
        // Accept JSON bodies even when an intermediary supplies the wrong media type.
        if (!is_array($params)) {
            $params = json_decode($request->get_body(), true);
        }

        if (!is_array($params) ||
            !isset($params['event_id'], $params['event_name'], $params['timestamp_ms']) ||
            !is_string($params['event_id']) || !is_string($params['event_name']) ||
            !is_numeric($params['timestamp_ms']) || $params['timestamp_ms'] <= 0) {
            return new WP_Error('invalid_payload', 'Missing event_id or event_name', ['status' => 400]);
        }

        $event_id = sanitize_text_field($params['event_id']);
        $event_name = sanitize_text_field($params['event_name']);
        if ($event_id === '' || $event_name === '' || strlen($event_id) > 128 || strlen($event_name) > 64) {
            return new WP_Error('invalid_payload', 'Invalid event identifier', ['status' => 400]);
        }

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
        $clean = [
            'event_id' => $event_id,
            'event_name' => $event_name,
            'timestamp_ms' => (int) $params['timestamp_ms'],
        ];
        foreach (['mode', 'cta', 'url'] as $field) {
            if (isset($params[$field]) && is_string($params[$field])) {
                $clean[$field] = $field === 'url' ? esc_url_raw($params[$field]) : sanitize_text_field($params[$field]);
            }
        }
        if (isset($params['verified']) && is_bool($params['verified'])) {
            $clean['verified'] = $params['verified'];
        }
        if (isset($params['properties']) && is_array($params['properties'])) {
            $clean['properties'] = $this->sanitize_event_properties($params['properties']);
        }
        do_action('fastlink_event_received', $clean);

        return rest_ensure_response([
            'status' => 'received',
            'event_id' => $event_id
        ]);
    }

    private function sanitize_event_properties(array $values) {
        $clean = [];
        foreach ($values as $key => $value) {
            $name = sanitize_text_field((string) $key);
            if (is_array($value)) $clean[$name] = $this->sanitize_event_properties($value);
            elseif (is_string($value)) $clean[$name] = sanitize_text_field($value);
            elseif (is_bool($value) || is_numeric($value)) $clean[$name] = $value;
        }
        return $clean;
    }
}

new FastLink_Plugin();
