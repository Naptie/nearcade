<script>
  let { children } = $props();
</script>

<div class="hover-3d">
  <!-- content -->
  {@render children?.()}
  <!-- 8 empty divs needed for the 3D effect -->
  <div></div>
  <div></div>
  <div></div>
  <div></div>
  <div></div>
  <div></div>
  <div></div>
  <div></div>
</div>
