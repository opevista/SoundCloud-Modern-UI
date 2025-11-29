// SoundCloud Modern UI - Content Script

(function () {
    let config = {
        mode: false
    };

    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let animationFrameId = null;
    let audioElement = null;
    let lastArtworkUrl = null;
    // ログのスパム対策フラグ
    let audioElementAbsentLogged = false;
    let audioElementNotReadyLogged = false;

    const ui = {
        bg: null,
        wrapper: null,
        title: null,
        artist: null,
        artwork: null,
        spectrum: null,
        btnArea: null
    };

    let hideTimer = null;

    const handleInteraction = () => {
        if (!ui.btnArea) return;
        ui.btnArea.classList.remove('inactive');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!ui.btnArea.matches(':hover')) {
                ui.btnArea.classList.add('inactive');
            }
        }, 3000);
    };

    const storage = {
        _api: chrome?.storage?.local,
        get: (k) => new Promise(r => {
            if (!storage._api) return r(null);
            storage._api.get([k], res => r(res[k] || null));
        }),
        set: (k, v) => { if (storage._api) storage._api.set({ [k]: v }); },
        remove: (k) => { if (storage._api) storage._api.remove(k); },
        clear: () => confirm('全データを削除しますか？') && storage._api?.clear(() => location.reload())
    };

    const createEl = (tag, id, cls, html) => {
        const el = document.createElement(tag);
        if (id) el.id = id;
        if (cls) el.className = cls;
        if (html !== undefined && html !== null) el.innerHTML = html;
        return el;
    };

    function setupAutoHideEvents() {
        if (document.body.dataset.autohideSetup) return;
        ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
        document.body.dataset.autohideSetup = "true";
        handleInteraction();
    }


    function initAudioSpectrum() {
        if (!ui.spectrum) {
            console.warn('[SCM] Spectrum container not found');
            return;
        }

        // 既存のcanvasを削除
        const existingCanvas = ui.spectrum.querySelector('canvas');
        if (existingCanvas) {
            existingCanvas.remove();
        }

        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 400;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        ui.spectrum.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const barCount = 128;
        const barWidth = canvas.width / barCount;

        function drawSpectrum() {
            if (!analyser || !dataArray) {
                animationFrameId = requestAnimationFrame(drawSpectrum);
                    return;
                }

            try {
                analyser.getByteFrequencyData(dataArray);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                for (let i = 0; i < barCount; i++) {
                    const dataIndex = Math.floor((i / barCount) * analyser.frequencyBinCount);
                    const barHeight = (dataArray[dataIndex] / 255) * canvas.height * 0.8;

                    const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                    gradient.addColorStop(0, `hsl(${200 + (dataIndex / analyser.frequencyBinCount) * 60}, 70%, 60%)`);
                    gradient.addColorStop(1, `hsl(${200 + (dataIndex / analyser.frequencyBinCount) * 60}, 70%, 40%)`);

                    ctx.fillStyle = gradient;
                    ctx.fillRect(i * barWidth, canvas.height - barHeight, barWidth - 2, barHeight);
                }
            } catch (e) {
                console.warn('[SCM] Error drawing spectrum:', e);
            }

            animationFrameId = requestAnimationFrame(drawSpectrum);
        }

        drawSpectrum();
    }

    function setupAudioAnalysis() {
        // 既存のコンテキストをクリーンアップ
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (audioContext) {
            try {
                audioContext.close();
            } catch (e) {
                console.warn('[SCM] Error closing audio context:', e);
            }
            audioContext = null;
        }

        audioElement = document.querySelector('audio');
        if (!audioElement) {
            // コンソールスパムを避けるため、発生時のみ最初に一度だけログを出す
            if (!audioElementAbsentLogged) {
                console.log('[SCM] Audio element not found, retrying...');
                audioElementAbsentLogged = true;
            }
            setTimeout(setupAudioAnalysis, 1000);
            return;
        }
        // オーディオが見つかったらログフラグをリセット
        audioElementAbsentLogged = false;

        // オーディオ要素が読み込まれているか確認
        if (audioElement.readyState === 0) {
            // readyState==0 のログも一度だけ出力してスパムを抑える
            if (!audioElementNotReadyLogged) {
                console.log('[SCM] Audio element not ready, waiting...');
                audioElementNotReadyLogged = true;
            }
            audioElement.addEventListener('loadedmetadata', () => {
                audioElementNotReadyLogged = false;
                setupAudioAnalysis();
            }, { once: true });
            return;
        }

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // サスペンド状態の場合は再開
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;

            const source = audioContext.createMediaElementSource(audioElement);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            console.log('[SCM] Audio analysis setup complete');
            initAudioSpectrum();
        } catch (e) {
            console.warn('[SCM] Audio analysis setup failed:', e);
            // エラーが発生した場合、少し待ってから再試行
            setTimeout(setupAudioAnalysis, 2000);
        }
    }

    function initLayout() {
        if (document.getElementById('scm-custom-wrapper')) {
            ui.wrapper = document.getElementById('scm-custom-wrapper');
            ui.bg = document.getElementById('scm-custom-bg');
            ui.spectrum = document.getElementById('scm-spectrum-container');
            ui.title = document.getElementById('scm-custom-title');
            ui.artist = document.getElementById('scm-custom-artist');
            ui.artwork = document.getElementById('scm-artwork-container');
            ui.btnArea = document.getElementById('scm-btn-area');
            setupAutoHideEvents();
            return;
        }

        ui.bg = createEl('div', 'scm-custom-bg');
        document.body.appendChild(ui.bg);

        ui.wrapper = createEl('div', 'scm-custom-wrapper');
        const leftCol = createEl('div', 'scm-custom-left-col');

        ui.artwork = createEl('div', 'scm-artwork-container');
        const info = createEl('div', 'scm-custom-info-area');
        ui.title = createEl('div', 'scm-custom-title');
        ui.artist = createEl('div', 'scm-custom-artist');

        ui.btnArea = createEl('div', 'scm-btn-area');

        info.append(ui.title, ui.artist, ui.btnArea);
        leftCol.append(ui.artwork, info);

        ui.spectrum = createEl('div', 'scm-spectrum-container');
        ui.wrapper.append(leftCol, ui.spectrum);
        document.body.appendChild(ui.wrapper);

        setupAutoHideEvents();
        setupAudioAnalysis();
    }

    const getMetadata = () => {
        let artworkSrc = null;

        if (navigator.mediaSession?.metadata) {
            const { title, artist, artwork } = navigator.mediaSession.metadata;
            artworkSrc = artwork.length ? artwork[artwork.length - 1].src : null;
            
            if (artworkSrc) {
                // prefer a fixed sized thumbnail -t500x500 for consistent display
                // map common patterns to -t500x500 (file suffix)
                artworkSrc = artworkSrc.replace(/-original\./g, '-t500x500.');
                artworkSrc = artworkSrc.replace(/-t\d+x\d+\./g, '-t500x500.');
                // map path-based sizes to /500x500/ or /500/ variations where applicable
                artworkSrc = artworkSrc.replace(/\/\d+x\d+\//g, '/500x500/');
                artworkSrc = artworkSrc.replace(/\/\d+\/\d+\//g, '/500/500/');
                artworkSrc = artworkSrc.replace(/\/\d+\//g, '/500/');
                lastArtworkUrl = artworkSrc;
            }
            
            return {
                title,
                artist,
                src: artworkSrc || lastArtworkUrl
            };
        }

        // SoundCloud specific selectors
        const titleEl = document.querySelector('.playbackSoundBadge__title a, .soundTitle__title, [itemprop="name"]');
        const artistEl = document.querySelector('.playbackSoundBadge__title a, .soundTitle__username, [itemprop="byArtist"]');
        const artworkEl = document.querySelector('.playbackSoundBadge__artwork img, .image__full, [itemprop="image"]');

        const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title') || '';
        const artist = artistEl?.textContent?.trim() || artistEl?.getAttribute('title') || '';
        let src = artworkEl?.src || artworkEl?.getAttribute('src') || null;

        if (src) {
            // prefer a consistent sized thumbnail (-t500x500) for the UI
            src = src.replace(/-original\./g, '-t500x500.');
            src = src.replace(/-t\d+x\d+\./g, '-t500x500.');
            src = src.replace(/\/\d+x\d+\//g, '/500x500/');
            src = src.replace(/\/\d+\/\d+\//g, '/500/500/');
            src = src.replace(/\/\d+\//g, '/500/');
            lastArtworkUrl = src;
        } else if (lastArtworkUrl) {
            // 新しいサムネイルが見つからない場合は、前のものを使用
            src = lastArtworkUrl;
        }

        return (title || artist) ? { title, artist, src } : null;
    };

    function updateMetaUI(meta) {
        if (!meta) return;
        if (ui.title) ui.title.innerText = meta.title || '';
        if (ui.artist) ui.artist.innerText = meta.artist || '';
        if (meta.src && ui.artwork) {
            // サムネイルが変更された場合のみ更新（ちらつき防止）
            const currentImg = ui.artwork.querySelector('img');
            if (!currentImg || currentImg.src !== meta.src) {
                ui.artwork.innerHTML = `<img src="${meta.src}" crossorigin="anonymous" style="width: 100%; height: 100%; object-fit: cover;">`;
                }
            if (ui.bg && ui.bg.style.backgroundImage !== `url(${meta.src})`) {
                ui.bg.style.backgroundImage = `url(${meta.src})`;
            }
        }
    }

    const tick = async () => {
        // Immersionモードはデフォルトでfalse（ボタンを押さないと有効にならない）

        // IMMERSIONボタンを常に表示（Immersionモードの状態に関係なく）
        let btn = document.getElementById('scm-mode-toggle');
        
        if (!btn) {
            // SoundCloudのプレーヤーコントロールを探す（複数のセレクターを試す）
            let playerBar = document.querySelector('.playControls');
            if (!playerBar) playerBar = document.querySelector('.playControls__inner');
            if (!playerBar) playerBar = document.querySelector('.playControls__container');
            if (!playerBar) playerBar = document.querySelector('[class*="playControls"]');
            
            if (playerBar) {
                btn = createEl('button', 'scm-mode-toggle', 'scm-mode-toggle', 'IMMERSION');
                btn.style.cssText = 'padding: 6px 12px; font-size: 11px; border-radius: 999px; background: rgba(255,255,255,0.16); color: #fff; border: none; cursor: pointer; font-weight: 700; margin-left: 8px; display: inline-block; visibility: visible; opacity: 1;';
                
                btn.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    config.mode = !config.mode;
                    storage.set('scm_mode', config.mode);
                    document.body.classList.toggle('scm-custom-layout', config.mode);
                    if (config.mode) {
                        setupAudioAnalysis();
                        } else {
                        if (animationFrameId) {
                            cancelAnimationFrame(animationFrameId);
                            animationFrameId = null;
            }
        }
                };
                
                // ボタンを確実に配置する
                // まず、右側のコントロールエリアを探す
                const rightControls = playerBar.querySelector('.playControls__actions') || 
                                     playerBar.querySelector('.playControls__right') ||
                                     playerBar.querySelector('[class*="actions"]') ||
                                     playerBar.querySelector('[class*="right"]');
                
                if (rightControls) {
                    rightControls.appendChild(btn);
                } else {
                    // 見つからない場合は、プレーヤーバー自体に直接追加
                    playerBar.appendChild(btn);
                }
                
                console.log('[SCM] IMMERSION button added to:', playerBar);
            } else {
                console.log('[SCM] Player bar not found');
                }
            }

        // 既存のボタンの状態を更新（ボタンが存在する場合）
        if (btn) {
            btn.classList.toggle('active', config.mode);
            // ボタンが表示されていることを確認
            if (btn.offsetParent === null && btn.style.display !== 'none') {
                btn.style.display = 'inline-block';
                btn.style.visibility = 'visible';
                btn.style.opacity = '1';
            }
        }

        if (!config.mode) {
            document.body.classList.remove('scm-custom-layout');
            return;
        }

        document.body.classList.add('scm-custom-layout');
        initLayout();

        const meta = getMetadata();
        if (meta) {
            updateMetaUI(meta);
        }

        // オーディオ分析を確実にセットアップ
        if (config.mode && !analyser) {
            setTimeout(() => {
                setupAudioAnalysis();
            }, 500);
    }
    };

    console.log("SoundCloud Modern UI loaded.");
    setInterval(tick, 1000);
})();
