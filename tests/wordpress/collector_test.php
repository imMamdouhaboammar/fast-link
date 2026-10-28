<?php
// Minimal WordPress REST seam: this tests the collector contract without a WP installation.
define('ABSPATH', __DIR__);
$GLOBALS['fl_transients'] = [];
$GLOBALS['fl_received'] = [];

class WP_Error {
    public function __construct(public string $code, public string $message, public array $data) {}
}
class WP_REST_Request {
    public function __construct(private string $body, private bool $jsonContentType = true) {}
    public function get_json_params() { return $this->jsonContentType ? json_decode($this->body, true) : null; }
    public function get_body() { return $this->body; }
}
function add_action($name, $callback) {}
function sanitize_text_field($value) { return trim(strip_tags((string)$value)); }
function esc_url_raw($value) { return filter_var($value, FILTER_SANITIZE_URL); }
function get_transient($key) { return $GLOBALS['fl_transients'][$key] ?? false; }
function set_transient($key, $value, $ttl) { $GLOBALS['fl_transients'][$key] = $value; }
function rest_ensure_response($value) { return $value; }
function do_action($hook, $payload) { $GLOBALS['fl_received'][] = $payload; }

require __DIR__ . '/../../examples/wordpress/fastlink-wp-plugin.php';
$collector = new FastLink_Plugin();

function assertResult($condition, $message) {
    if (!$condition) { fwrite(STDERR, "FAIL: $message\n"); exit(1); }
}
function collect($payload, $json = true) {
    global $collector;
    return $collector->handle_event_ingestion(new WP_REST_Request(is_string($payload) ? $payload : json_encode($payload), $json));
}

$event = ['event_id' => 'evt-1', 'event_name' => 'Contact', 'timestamp_ms' => 1700000000000];
$received = collect($event, false);
assertResult(is_array($received) && $received['status'] === 'received', 'valid JSON body without WP JSON parameter parsing');
assertResult(count($GLOBALS['fl_received']) === 1, 'event reaches downstream hook');
assertResult(collect($event, false)['status'] === 'deduplicated', 'duplicate events deduplicated');
assertResult(collect('{not json') instanceof WP_Error, 'malformed JSON denied');
assertResult(collect(['event_name' => 'Contact', 'timestamp_ms' => 1]) instanceof WP_Error, 'missing ID denied');
assertResult(collect(['event_id' => 'evt-2', 'event_name' => 'Contact']) instanceof WP_Error, 'missing timestamp denied');
assertResult(collect(['event_id' => str_repeat('x', 129), 'event_name' => 'Contact', 'timestamp_ms' => 1]) instanceof WP_Error, 'oversized ID denied');
assertResult(collect(['event_id' => 'evt-3', 'event_name' => str_repeat('x', 65), 'timestamp_ms' => 1]) instanceof WP_Error, 'oversized name denied');
collect(['event_id' => '<b>evt-4</b>', 'event_name' => '<b>Contact</b>', 'timestamp_ms' => 1]);
$last = end($GLOBALS['fl_received']);
assertResult($last['event_id'] === 'evt-4' && $last['event_name'] === 'Contact', 'hook receives sanitized fields');
fwrite(STDOUT, "WordPress collector contract: PASS\n");
