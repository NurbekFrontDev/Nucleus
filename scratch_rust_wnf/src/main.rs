use wnf::{StateName, BorrowedState};

fn main() {
    let state_name = StateName::from_opaque_value(0xd83063ea3bf1c75);
    let state = BorrowedState::<u32>::from_state_name(state_name);
    
    // Read current state
    match state.get() {
        Ok(val) => println!("Current state: {}", val),
        Err(e) => println!("Failed to read state: {:?}", e),
    }

    // Attempt to set state to 2 (Alarms Only)
    match state.set(&2) {
        Ok(_) => println!("Successfully updated WNF state to 2!"),
        Err(e) => println!("Failed to set state: {:?}", e),
    }
}
