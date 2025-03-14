use memflow::{mem::MemoryView, types::Address, os::ModuleInfo};
use crate::pattern::pattern_scan;

const BUF_SIZE: usize = 3;

pub struct MoneyReveal {
    pub is_enabled: bool,
    pub address: Option<Address>,
    original_bytes: Option<[u8; BUF_SIZE]>,
}

impl MoneyReveal {
    pub fn new() -> Self {
        Self {
            is_enabled: false,
            address: None,
            original_bytes: None,
        }
    }

    pub fn init(&mut self, mem: &mut impl MemoryView, client_module: &ModuleInfo) -> anyhow::Result<()> {
        self.address = self.find_function(mem, client_module)?;
        log::info!("Money reveal function found at: {:?}", self.address);
        Ok(())
    }

    pub fn toggle(&mut self, mem: &mut impl MemoryView) -> anyhow::Result<bool> {
        if let Some(addr) = self.address {
            if self.is_enabled {
                if let Some(original) = self.original_bytes {
                    self.restore(mem, addr, original)?;
                    self.original_bytes = None;
                    self.is_enabled = false;
                }
            } else {
                let original = self.patch(mem, addr)?;
                self.original_bytes = Some(original);
                self.is_enabled = true;
            }
            Ok(self.is_enabled)
        } else {
            Err(anyhow::anyhow!("Money reveal not initialized"))
        }
    }

    pub fn ensure_disabled(&mut self, mem: &mut impl MemoryView) -> anyhow::Result<()> {
        if self.is_enabled {
            if let Some(addr) = self.address {
                if let Some(original) = self.original_bytes {
                    self.restore(mem, addr, original)?;
                    self.is_enabled = false;
                }
            }
        }
        Ok(())
    }

    fn find_function(&self, mem: &mut impl MemoryView, module: &ModuleInfo) -> anyhow::Result<Option<Address>> {
        let is_hltv = pattern_scan(
            mem,
            module,
            "48 83 EC 28 48 8B 0D ?? ?? ?? ?? 48 8B 01 FF 90 ?? ?? ?? ?? 84 C0 75 0D"
        )?;

        if is_hltv.is_none() {
            Ok(pattern_scan(
                mem,
                module,
                "B0 01 C3 28 48 8B 0D ?? ?? ?? ?? 48 8B 01 FF 90 ?? ?? ?? ?? 84 C0 75 0D"
            )?)
        } else {
            Ok(is_hltv)
        }
    }

    fn patch(&self, mem: &mut impl MemoryView, location: Address) -> anyhow::Result<[u8; BUF_SIZE]> {
        let mut original_buf = [0u8; BUF_SIZE];
        mem.read_into(location, &mut original_buf)?;

        let new_buf: [u8; BUF_SIZE] = [
            0xB0, 0x01,     // MOV AL,1
            0xC3            // RET
        ];

        log::debug!("Patching memory for money reveal");
        mem.write(location, &new_buf)?;

        Ok(original_buf)
    }

    fn restore(&self, mem: &mut impl MemoryView, location: Address, original: [u8; BUF_SIZE]) -> anyhow::Result<()> {
        log::debug!("Restoring memory for money reveal");
        mem.write(location, &original)?;
        Ok(())
    }
}