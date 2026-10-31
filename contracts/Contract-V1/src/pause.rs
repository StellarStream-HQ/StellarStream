use soroban_sdk::{contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PauseKey {
    IsPaused,
    Pauser,
    Admin,
}

pub struct EmergencyPauseManager;

impl EmergencyPauseManager {
    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&PauseKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn pause(env: &Env, caller: &Address) -> Result<(), &'static str> {
        caller.require_auth();
        let pauser: Option<Address> = env.storage().instance().get(&PauseKey::Pauser);
        let admin: Option<Address> = env.storage().instance().get(&PauseKey::Admin);

        let is_authorized = match (&pauser, &admin) {
            (Some(p), _) if p == caller => true,
            (_, Some(a)) if a == caller => true,
            _ => false,
        };

        if !is_authorized {
            return Err("Unauthorized: caller is neither pauser nor admin");
        }

        env.storage().instance().set(&PauseKey::IsPaused, &true);
        env.events().publish((Symbol::new(env, "contract_paused"),), (caller.clone(),));
        Ok(())
    }

    pub fn unpause(env: &Env, admin: &Address) -> Result<(), &'static str> {
        admin.require_auth();
        let current_admin: Option<Address> = env.storage().instance().get(&PauseKey::Admin);

        if let Some(stored_admin) = current_admin {
            if &stored_admin != admin {
                return Err("Unauthorized: only admin can unpause");
            }
        }

        env.storage().instance().set(&PauseKey::IsPaused, &false);
        env.events().publish((Symbol::new(env, "contract_unpaused"),), (admin.clone(),));
        Ok(())
    }
}
