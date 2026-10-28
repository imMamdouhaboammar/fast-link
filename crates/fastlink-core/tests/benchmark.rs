use std::time::Instant;
use fastlink_core::{
    resolve_fast_link, AnchorAttributes, InteractionContext, ModifierKeys, PointerType,
};

#[test]
fn bench_link_eligibility_throughput() {
    let ctx = InteractionContext {
        pointer_type: PointerType::Mouse,
        button: 0,
        modifiers: ModifierKeys::default(),
        default_prevented: false,
        is_handled: false,
        nested_control: false,
        nested_button_role: false,
        current_origin: "https://example.com".to_string(),
        base_uri: Some("https://example.com/docs/intro".to_string()),
    };

    let anchor = AnchorAttributes {
        href: Some("/docs/setup".to_string()),
        target: None,
        download: false,
        role: None,
        data_no_fast_link: false,
    };

    let iterations = 100_000;
    let start = Instant::now();

    for _ in 0..iterations {
        let res = resolve_fast_link(&ctx, &anchor);
        assert!(res.is_eligible());
    }

    let elapsed = start.elapsed();
    let nanos_per_op = elapsed.as_nanos() as f64 / iterations as f64;
    let ops_per_sec = iterations as f64 / elapsed.as_secs_f64();

    println!(
        "\n⚡ FastLink Rust Core Benchmark: {:.2} ns/op ({:.0} ops/sec)\n",
        nanos_per_op, ops_per_sec
    );

    #[cfg(not(debug_assertions))]
    assert!(
        nanos_per_op < 2000.0,
        "Release evaluation took {}ns, expected < 2000ns",
        nanos_per_op
    );

    #[cfg(debug_assertions)]
    assert!(
        nanos_per_op < 30_000.0,
        "Debug evaluation took {}ns, expected < 30000ns",
        nanos_per_op
    );
}
