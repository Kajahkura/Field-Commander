// Build-time decoder for the Debian Rust compiler image's liblzma runtime.
// No executable, binary dependency or network fetch is included in the source.
#[link(name="liblzma.so.5", kind="dylib", modifiers="+verbatim")]
extern "C" {
    fn lzma_stream_buffer_decode(limit: *mut u64, flags: u32, allocator: *const std::ffi::c_void, input: *const u8, input_pos: *mut usize, input_size: usize, output: *mut u8, output_pos: *mut usize, output_size: usize) -> i32;
}
fn extract_archive(compressed: &[u8], directory: &Path) {
    let mut decoded=vec![0u8;16*1024*1024];let mut limit=256*1024*1024u64;let mut input_pos=0usize;let mut output_pos=0usize;
    let status=unsafe{lzma_stream_buffer_decode(&mut limit,0,std::ptr::null(),compressed.as_ptr(),&mut input_pos,compressed.len(),decoded.as_mut_ptr(),&mut output_pos,decoded.len())};
    assert_eq!(status,0,"Dependency archive failed integrity or memory checks");assert_eq!(input_pos,compressed.len());decoded.truncate(output_pos);
    let mut position=0usize;
    while position+512<=decoded.len() {
        let header=&decoded[position..position+512];if header.iter().all(|b|*b==0){break}
        let text=|bytes:&[u8]|String::from_utf8(bytes.iter().copied().take_while(|b|*b!=0).collect()).expect("UTF-8 archive metadata");
        let prefix=text(&header[345..500]);let name=text(&header[..100]);let path=if prefix.is_empty(){name}else{format!("{prefix}/{name}")};
        let relative=std::path::Path::new(&path);
        assert!(relative.components().all(|part|matches!(part,std::path::Component::Normal(_))),"Unsafe dependency path");
        assert!(header[156]==b'0'||header[156]==0,"Only regular source files are accepted");
        let expected=u64::from_str_radix(text(&header[148..156]).trim(),8).expect("Tar header checksum");
        let actual:u64=header.iter().enumerate().map(|(i,b)|if (148..156).contains(&i){32}else{*b as u64}).sum();assert_eq!(expected,actual,"Tar header checksum mismatch");
        let size=usize::from_str_radix(text(&header[124..136]).trim(),8).expect("Archive source size");
        let start=position+512;let end=start.checked_add(size).expect("Archive size overflow");assert!(end<=decoded.len()&&size<=2*1024*1024,"Dependency file size limit");
        let dest=directory.join(relative);fs::create_dir_all(dest.parent().unwrap()).unwrap();fs::write(dest,&decoded[start..end]).expect("Extract dependency source");
        position=start+size.div_ceil(512)*512;
    }
}
