#![allow(dead_code)]

#[path = "../../src/game/mod.rs"]
pub(crate) mod game;

#[path = "../../src/bindings.rs"]
mod bindings;

pub use bindings::*;