const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_AVATAR_BYTES = 2_097_152

export function validateAvatarBlob(blob) {
  if (!(blob instanceof Blob) || !AVATAR_TYPES.has(blob.type)) {
    throw new Error("รูป Profile ต้องเป็น JPEG, PNG หรือ WebP")
  }
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error("รูป Profile ต้องมีขนาดไม่เกิน 2 MB")
  }
  return blob
}

export function avatarBlobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas?.toBlob) {
      reject(new Error("สร้างไฟล์รูปไม่สำเร็จ กรุณาเลือกรูปใหม่"))
      return
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("สร้างไฟล์รูปไม่สำเร็จ กรุณาเลือกรูปใหม่"))
        return
      }
      try {
        resolve(validateAvatarBlob(blob))
      } catch (error) {
        reject(error)
      }
    }, "image/jpeg", 0.85)
  })
}

export async function persistAvatarChange({ members, memberName, blob, upload, persist, remove }) {
  const normalizedName = String(memberName || "").trim().toLocaleLowerCase("th-TH")
  const target = members.find((member) => member.name.trim().toLocaleLowerCase("th-TH") === normalizedName)
  if (!target) throw new Error("ไม่พบสมาชิกที่ต้องการเปลี่ยนรูป")

  const uploadedUrl = await upload(validateAvatarBlob(blob))
  if (!uploadedUrl) throw new Error("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่")

  const nextMembers = members.map((member) => member === target ? { ...member, avatar: uploadedUrl } : member)
  let saved
  try {
    saved = await persist(target.name, uploadedUrl)
  } catch (error) {
    try { await remove(uploadedUrl) } catch { /* best-effort orphan cleanup */ }
    throw error
  }

  if (!saved) {
    try { await remove(uploadedUrl) } catch { /* best-effort orphan cleanup */ }
    return { saved: false, members }
  }

  if (target.avatar && target.avatar !== uploadedUrl) {
    try { await remove(target.avatar) } catch { /* the new avatar is already durable */ }
  }
  return { saved: true, memberName: target.name, members: nextMembers, avatar: uploadedUrl }
}
